const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const geminiService = require('./geminiService');

async function executeInstructions(initialInstructions, userRequest) {
  console.log('Bắt đầu thực hiện tự động hóa với Puppeteer');
  
  // Khởi động trình duyệt
  console.log('Đang khởi động trình duyệt...');
  
  // Sử dụng Chrome profile nếu được chỉ định trong biến môi trường
  const profilePath = process.env.CHROME_PROFILE_PATH || path.join(__dirname, '../chrome-profile');
  
  // Đảm bảo thư mục profile tồn tại
  if (!fs.existsSync(profilePath)) {
    fs.mkdirSync(profilePath, { recursive: true });
    console.log(`Đã tạo thư mục profile Chrome tại: ${profilePath}`);
  }
  
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      '--start-maximized',
      `--user-data-dir=${profilePath}`
    ]
  });

  const page = await browser.newPage();
  const executedSteps = [];
  
  try {
    // Truy cập URL ban đầu
    console.log(`Đang truy cập: ${initialInstructions.url}`);
    await page.goto(initialInstructions.url, { waitUntil: 'networkidle2' });
    
    // Kiểm tra captcha
    await handleCaptchaIfPresent(page);
    
    // Thực hiện bước đầu tiên
    let currentStep = initialInstructions.nextStep;
    let isCompleted = false;
    
    while (!isCompleted) {
      console.log(`Thực hiện bước: ${currentStep.description}`);
      
      // Lưu trạng thái trước khi thực hiện hành động để so sánh
      const beforeState = {
        url: page.url(),
        title: await page.title(),
        content: await page.content()
      };
      
      // Luôn kiểm tra CAPTCHA trước khi thực hiện bất kỳ hành động nào
      const captchaResult = await handleCaptchaIfPresent(page);
      if (!captchaResult) {
        console.log("Có vấn đề với CAPTCHA, tiếp tục thử thực hiện hành động...");
      }
      
      // Lấy HTML hiện tại và gửi cho Gemini để phân tích trước khi thực hiện hành động
      const htmlBeforeAction = await page.content();
      const currentUrlBeforeAction = await page.url();
      const titleBeforeAction = await page.title();
      
      // Gửi HTML cho Gemini để phân tích trước khi thực hiện
      console.log('Đang gửi HTML cho Gemini để phân tích trước khi thực hiện hành động...');
      const htmlAnalysisBeforeAction = await geminiService.analyzeHTMLStructure(
        htmlBeforeAction, 
        {
          url: currentUrlBeforeAction,
          title: titleBeforeAction
        }, 
        `Chuẩn bị thực hiện hành động: "${currentStep.action}" trên phần tử "${currentStep.selector || ''}"`
      );
      
      console.log('Kết quả phân tích HTML trước hành động:', htmlAnalysisBeforeAction);
      
      // Nếu Gemini gợi ý selector tốt hơn, sử dụng nó
      if (htmlAnalysisBeforeAction.recommendedSelector && 
          currentStep.selector && 
          htmlAnalysisBeforeAction.recommendedSelector !== currentStep.selector) {
        console.log(`Gemini đề xuất selector tốt hơn: ${htmlAnalysisBeforeAction.recommendedSelector} thay vì ${currentStep.selector}`);
        currentStep.selector = htmlAnalysisBeforeAction.recommendedSelector;
      }
      
      // Thực hiện hành động
      let actionResult = { success: false, message: "" };
      try {
        // Thử thực hiện hành động 
        await executeAction(page, currentStep);
        
        // Kiểm tra xem có captcha xuất hiện sau hành động không
        await handleCaptchaIfPresent(page);
        
        actionResult.success = true;
        actionResult.message = "Thành công";
        
        // Chỉ tô màu phần tử nếu hành động thành công
        if (currentStep.selector) {
          const randomColor = `#${Math.floor(Math.random()*16777215).toString(16)}`;
          await highlightElement(page, currentStep.selector, randomColor);
          console.log(`✅ Phần tử: ${currentStep.selector} đã được tô viền màu ${randomColor}`);
        }
      } catch (actionError) {
        console.error(`Lỗi khi thực hiện hành động: ${actionError.message}`);
        actionResult.message = actionError.message;
        
        // Lấy HTML hiện tại sau khi thực hiện thất bại
        const htmlAfterFailedAction = await page.content();
        const stateAfterFailed = {
          url: await page.url(),
          title: await page.title()
        };
        
        // Gửi HTML cho Gemini để phân tích lỗi
        console.log('Đang gửi HTML cho Gemini để phân tích lỗi...');
        const htmlAnalysisAfterFail = await geminiService.analyzeHTMLStructure(
          htmlAfterFailedAction, 
          stateAfterFailed, 
          `Gặp lỗi khi thực hiện "${currentStep.action}" trên phần tử "${currentStep.selector || ''}": ${actionError.message}`
        );
        
        console.log('Kết quả phân tích lỗi:', htmlAnalysisAfterFail);
        
        // Nếu có selector thay thế được đề xuất, thử lại với selector mới
        if (htmlAnalysisAfterFail.recommendedSelector) {
          console.log(`Thử lại với selector được đề xuất: ${htmlAnalysisAfterFail.recommendedSelector}`);
          currentStep.selector = htmlAnalysisAfterFail.recommendedSelector;
          try {
            await executeAction(page, currentStep);
            actionResult.success = true;
            actionResult.message = "Thành công sau khi sử dụng selector được đề xuất bởi Gemini";
          } catch (retryError) {
            console.error("Vẫn không thành công với selector được đề xuất");
            
            // Thử JavaScript fallback nếu có
            if (htmlAnalysisAfterFail.javascriptFallback) {
              console.log("Thử sử dụng JavaScript fallback được đề xuất");
              try {
                await page.evaluate((jsCode, value) => {
                  eval(jsCode.replace('VALUE_TO_REPLACE', value));
                }, htmlAnalysisAfterFail.javascriptFallback, currentStep.value || '');
                
                actionResult.success = true;
                actionResult.message = "Thành công sau khi sử dụng JavaScript fallback được đề xuất bởi Gemini";
              } catch (jsError) {
                console.error("JavaScript fallback cũng thất bại:", jsError);
              }
            }
          }
        }
      }
      
      // Chờ trang web phản hồi
      await page.waitForTimeout(2000);
      
      // Kiểm tra lại CAPTCHA sau hành động
      await handleCaptchaIfPresent(page);
      
      // Xác minh hành động đã thành công
      const verificationResult = await verifyAction(page, currentStep, beforeState);
      if (verificationResult.verified) {
        console.log(`✅ Xác minh hành động thành công: ${verificationResult.message}`);
        actionResult.success = true;
        actionResult.message = `Đã xác minh: ${verificationResult.message}`;
      } else if (actionResult.success) {
        console.log(`⚠️ Hành động dường như đã thực hiện nhưng không thể xác minh: ${verificationResult.message}`);
        actionResult.message = `Không thể xác minh đầy đủ: ${verificationResult.message}`;
      } else {
        console.error(`❌ Xác minh hành động thất bại: ${verificationResult.message}`);
      }
      
      // Chụp ảnh màn hình cho bước hiện tại
      const stepScreenshotDir = path.join(__dirname, '../public/screenshots/steps');
      if (!fs.existsSync(stepScreenshotDir)) {
        fs.mkdirSync(stepScreenshotDir, { recursive: true });
      }
      const stepScreenshotPath = path.join(stepScreenshotDir, `step_${executedSteps.length + 1}_${Date.now()}.png`);
      await page.screenshot({ path: stepScreenshotPath, fullPage: false });
      
      // Lưu bước đã thực hiện
      executedSteps.push({
        description: currentStep.description,
        action: currentStep.action,
        selector: currentStep.selector,
        value: currentStep.value,
        result: actionResult.success ? "Thành công" : "Thất bại",
        message: actionResult.message,
        screenshotPath: `/screenshots/steps/${path.basename(stepScreenshotPath)}`
      });
      
      // Lấy HTML hiện tại sau khi thực hiện
      const htmlAfterAction = await page.content();
      
      // Lấy trạng thái hiện tại của trang
      const currentState = {
        url: await page.url(),
        title: await page.title(),
        htmlContent: htmlAfterAction.substring(0, 50000) // Lấy 50k ký tự đầu tiên của HTML
      };
      
      // Phân tích cấu trúc HTML và các phần tử tương tác
      const pageStructure = await analyzePageStructure(page);
      
      // Quyết định bước tiếp theo với HTML đầy đủ
      console.log('Đang gửi HTML hiện tại và quyết định bước tiếp theo...');
      const decision = await geminiService.decideNextStepWithHTML(
        userRequest, 
        currentState, 
        executedSteps,
        pageStructure,
        htmlAfterAction
      );
      
      if (decision.completed) {
        console.log('Hoàn thành tự động hóa:', decision.summary);
        isCompleted = true;
      } else {
        currentStep = decision.nextStep;
      }
    }
    
    // Chụp ảnh màn hình cuối cùng
    const screenshotDir = path.join(__dirname, '../public/screenshots');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    const finalScreenshotPath = path.join(screenshotDir, `final_${Date.now()}.png`);
    await page.screenshot({ path: finalScreenshotPath, fullPage: true });
    
    console.log(`Đã hoàn thành tất cả ${executedSteps.length} bước.`);
    return {
      steps: executedSteps,
      screenshotPath: `/screenshots/${path.basename(finalScreenshotPath)}`
    };
  } catch (error) {
    console.error('Lỗi khi thực hiện tự động hóa:', error);
    throw error;
  } finally {
    await browser.close();
    console.log('Đã đóng trình duyệt.');
  }
}

// Hàm xác minh hành động đã thành công
async function verifyAction(page, action, beforeState) {
  console.log('Đang xác minh hành động...');
  const result = { verified: false, message: "" };
  
  try {
    // Lấy trạng thái hiện tại
    const currentUrl = await page.url();
    const currentTitle = await page.title();
    
    switch (action.action) {
      case 'click':
        // Kiểm tra xem URL hoặc tiêu đề có thay đổi không (có thể là chuyển trang)
        if (currentUrl !== beforeState.url) {
          result.verified = true;
          result.message = `URL đã thay đổi từ ${beforeState.url} thành ${currentUrl}`;
          return result;
        }
        
        if (currentTitle !== beforeState.title) {
          result.verified = true;
          result.message = `Tiêu đề trang đã thay đổi từ "${beforeState.title}" thành "${currentTitle}"`;
          return result;
        }
        
        // Kiểm tra xem có phần tử mới xuất hiện không
        const hasNewElements = await page.evaluate(() => {
          const newElements = document.querySelectorAll('[data-new="true"], .new, .active, .show, .open, [aria-expanded="true"]');
          return newElements.length > 0;
        });
        
        if (hasNewElements) {
          result.verified = true;
          result.message = "Phát hiện phần tử mới xuất hiện sau khi nhấp";
          return result;
        }
        
        // Kiểm tra xem có bất kỳ hộp thoại hoặc popup nào xuất hiện không
        const hasDialogs = await page.evaluate(() => {
          const dialogs = document.querySelectorAll('.modal.show, .popup, .tooltip, .dropdown-menu.show');
          return dialogs.length > 0;
        });
        
        if (hasDialogs) {
          result.verified = true;
          result.message = "Phát hiện hộp thoại hoặc popup xuất hiện";
          return result;
        }
        
        // Nếu không có thay đổi rõ ràng, kiểm tra xem phần tử có trạng thái active/focus không
        if (action.selector) {
          const elementState = await page.evaluate((selector) => {
            const element = document.querySelector(selector);
            if (!element) return null;
            
            const isActive = element.classList.contains('active');
            const isFocused = document === document.activeElement || element === document.activeElement;
            const isChecked = element.checked;
            
            return { isActive, isFocused, isChecked };
          }, action.selector);
          
          if (elementState) {
            if (elementState.isActive || elementState.isFocused || elementState.isChecked) {
              result.verified = true;
              result.message = "Phần tử đã được kích hoạt hoặc có focus";
              return result;
            }
          }
        }
        
        // Nếu không thể xác minh rõ ràng, hãy kiểm tra xem có lỗi hiển thị không
        const hasErrors = await page.evaluate(() => {
          const errorElements = document.querySelectorAll('.error, .alert-danger, [role="alert"]');
          for (const el of errorElements) {
            if (window.getComputedStyle(el).display !== 'none') {
              return true;
            }
          }
          return false;
        });
        
        if (hasErrors) {
          result.verified = false;
          result.message = "Phát hiện thông báo lỗi xuất hiện trên trang";
          return result;
        }
        
        result.verified = true; // Mặc định là thành công nếu không phát hiện lỗi
        result.message = "Không có lỗi xuất hiện sau khi nhấp, giả định thành công";
        break;
        
      case 'type':
        // Xác minh giá trị đã được nhập vào trường
        if (action.selector) {
          const inputValue = await page.evaluate((selector) => {
            const element = document.querySelector(selector);
            return element ? element.value : null;
          }, action.selector);
          
          if (inputValue && inputValue.includes(action.value)) {
            result.verified = true;
            result.message = `Trường đã được nhập với giá trị "${inputValue}"`;
            return result;
          } else if (inputValue) {
            result.verified = false;
            result.message = `Trường có giá trị "${inputValue}" không khớp với giá trị dự kiến "${action.value}"`;
            return result;
          } else {
            result.verified = false;
            result.message = "Không thể xác minh giá trị đã nhập";
            return result;
          }
        }
        break;
        
      case 'select':
        // Xác minh option đã được chọn
        if (action.selector) {
          const selectedOption = await page.evaluate((selector) => {
            const element = document.querySelector(selector);
            return element ? {
              value: element.value,
              text: element.options[element.selectedIndex].text
            } : null;
          }, action.selector);
          
          if (selectedOption && (selectedOption.value === action.value || selectedOption.text === action.value)) {
            result.verified = true;
            result.message = `Option "${selectedOption.text}" đã được chọn`;
            return result;
          } else if (selectedOption) {
            result.verified = false;
            result.message = `Option đã chọn "${selectedOption.text}" không khớp với giá trị dự kiến "${action.value}"`;
            return result;
          } else {
            result.verified = false;
            result.message = "Không thể xác minh option đã chọn";
            return result;
          }
        }
        break;
        
      case 'navigate':
        // Xác minh đã điều hướng đến URL mới
        if (currentUrl.includes(action.value) || action.value.includes(currentUrl)) {
          result.verified = true;
          result.message = `Đã điều hướng đến URL ${currentUrl}`;
          return result;
        } else {
          result.verified = false;
          result.message = `URL hiện tại ${currentUrl} không khớp với URL dự kiến ${action.value}`;
          return result;
        }
        break;
        
      default:
        // Đối với các hành động khác, hãy kiểm tra trạng thái chung
        // Kiểm tra xem có lỗi hiển thị không
        const hasGenericErrors = await page.evaluate(() => {
          const errorElements = document.querySelectorAll('.error, .alert-danger, [role="alert"]');
          for (const el of errorElements) {
            if (window.getComputedStyle(el).display !== 'none') {
              return { hasError: true, text: el.innerText };
            }
          }
          return { hasError: false };
        });
        
        if (hasGenericErrors.hasError) {
          result.verified = false;
          result.message = `Phát hiện thông báo lỗi: ${hasGenericErrors.text || 'Không rõ lỗi'}`;
          return result;
        }
        
        result.verified = true;
        result.message = "Không phát hiện lỗi, giả định thành công";
        break;
    }
  } catch (error) {
    console.error("Lỗi khi xác minh hành động:", error);
    result.verified = false;
    result.message = `Không thể xác minh do lỗi: ${error.message}`;
  }
  
  return result;
}

// Phân tích cấu trúc trang web và trích xuất các phần tử tương tác
async function analyzePageStructure(page) {
  console.log('Đang phân tích cấu trúc trang...');
  
  return await page.evaluate(() => {
    // Lấy snapshot của DOM hiện tại
    const domSnapshot = document.documentElement.outerHTML.substring(0, 10000); // Lấy 10000 ký tự đầu của HTML
    
    // Phân tích forms
    const forms = Array.from(document.forms).map((form, index) => {
      const fields = Array.from(form.elements)
        .filter(el => el.tagName !== 'FIELDSET' && !['button', 'submit', 'reset'].includes(el.type))
        .map(field => {
          // Lấy thông tin chi tiết về trường
          const rect = field.getBoundingClientRect();
          return {
            type: field.type || field.tagName.toLowerCase(),
            name: field.name,
            id: field.id,
            placeholder: field.placeholder,
            value: field.value,
            isRequired: field.required,
            isVisible: rect.width > 0 && rect.height > 0 && window.getComputedStyle(field).display !== 'none',
            selector: getUniqueSelector(field)
          };
        });
      
      return {
        id: form.id,
        name: form.name,
        action: form.action,
        method: form.method,
        index,
        fields
      };
    });
    
    // Phân tích buttons
    const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]'))
      .map(btn => {
        const rect = btn.getBoundingClientRect();
        return {
          text: btn.innerText || btn.value || btn.title || '',
          id: btn.id,
          name: btn.name,
          type: btn.type || 'button',
          isVisible: rect.width > 0 && rect.height > 0 && window.getComputedStyle(btn).display !== 'none',
          selector: getUniqueSelector(btn)
        };
      });
    
    // Lấy inputs ngoài form
    const inputs = Array.from(document.querySelectorAll('input:not(form input), textarea:not(form textarea), select:not(form select)'))
      .map(input => {
        const rect = input.getBoundingClientRect();
        return {
          type: input.type || input.tagName.toLowerCase(),
          name: input.name,
          id: input.id,
          placeholder: input.placeholder,
          value: input.value,
          isVisible: rect.width > 0 && rect.height > 0 && window.getComputedStyle(input).display !== 'none',
          selector: getUniqueSelector(input)
        };
      });
    
    // Tìm tất cả search boxes tiềm năng
    const searchBoxes = Array.from(document.querySelectorAll('input[type="search"], input[name*="search"], input[name*="query"], input[name="q"], textarea[name="q"], [role="search"] input'))
      .map(search => {
        return {
          type: search.type || search.tagName.toLowerCase(),
          name: search.name,
          id: search.id,
          placeholder: search.placeholder,
          value: search.value,
          selector: getUniqueSelector(search)
        };
      });
    
    // Phân tích links
    const links = Array.from(document.querySelectorAll('a[href]')).map(link => {
      return {
        text: link.innerText,
        href: link.href,
        selector: getUniqueSelector(link)
      };
    });
    
    // Phân tích nội dung chính
    const mainContent = Array.from(document.querySelectorAll('h1, h2, h3, p, main, article, [role="main"]')).map(el => {
      return {
        tag: el.tagName.toLowerCase(),
        text: el.innerText,
        selector: getUniqueSelector(el)
      };
    });
    
    // Hàm helper để lấy selector CSS độc nhất
    function getUniqueSelector(el) {
      if (!el) return '';
      
      if (el.id) return `#${el.id}`;
      
      if (el.name) {
        const nameSelector = `${el.tagName.toLowerCase()}[name="${el.name}"]`;
        // Kiểm tra tính độc nhất
        if (document.querySelectorAll(nameSelector).length === 1) {
          return nameSelector;
        }
      }
      
      const classes = Array.from(el.classList).join('.');
      if (classes) {
        const classSelector = `${el.tagName.toLowerCase()}.${classes}`;
        if (document.querySelectorAll(classSelector).length === 1) {
          return classSelector;
        }
      }
      
      // Trường hợp phức tạp
      if (el.parentElement) {
        // Tìm vị trí của phần tử trong phần tử cha
        const index = Array.from(el.parentElement.children).indexOf(el);
        return `${getUniqueSelector(el.parentElement)} > ${el.tagName.toLowerCase()}:nth-child(${index + 1})`;
      }
      
      return el.tagName.toLowerCase();
    }
    
    return {
      forms,
      buttons,
      inputs,
      links,
      searchBoxes,
      mainContent,
      domSnapshot
    };
  });
}

// Hàm để tô sáng phần tử trên trang
async function highlightElement(page, selector, color) {
  try {
    const elementExists = await page.evaluate((selector) => {
      return !!document.querySelector(selector);
    }, selector);
    
    if (!elementExists) {
      console.log(`Không tìm thấy phần tử với selector: ${selector}`);
      return false;
    }
    
    await page.evaluate((selector, color) => {
      const element = document.querySelector(selector);
      if (element) {
        element.style.border = `3px solid ${color}`;
        element.style.boxShadow = `0 0 10px ${color}`;
      }
    }, selector, color);
    
    console.log(`Phần tử: ${selector} đã được tô viền màu ${color}`);
    return true;
  } catch (error) {
    console.error(`Không thể tô viền phần tử ${selector}:`, error);
    return false;
  }
}

// Tìm phần tử bằng text và tô viền
async function findElementByTextAndHighlight(page, text, color) {
  try {
    const found = await page.evaluate((text, color) => {
      // Tìm tất cả các phần tử có text
      const allElements = document.querySelectorAll('a, button, input[type="submit"], input[type="button"], [role="button"], label, h1, h2, h3, h4, h5, h6, p, span, div');
      let foundElement = null;
      
      for (const element of allElements) {
        // Kiểm tra cả innerText và value (cho button, input)
        const elementText = element.innerText || element.value || '';
        if (elementText.includes(text)) {
          element.style.border = `3px solid ${color}`;
          element.style.boxShadow = `0 0 10px ${color}`;
          foundElement = {
            tag: element.tagName.toLowerCase(),
            text: elementText,
            selector: element.id ? `#${element.id}` : null
          };
          break;
        }
      }
      
      return foundElement;
    }, text, color);
    
    if (found) {
      console.log(`Đã tìm thấy phần tử bằng text "${text}": ${JSON.stringify(found)}`);
      return true;
    }
    
    console.log(`Không tìm thấy phần tử nào chứa text: ${text}`);
    return false;
  } catch (error) {
    console.error(`Lỗi khi tìm phần tử bằng text:`, error);
    return false;
  }
}

// Hàm thực hiện một hành động cụ thể
async function executeAction(page, step) {
  switch (step.action) {
    case 'type':
      try {
        // Cố gắng tìm phần tử nhập liệu với nhiều cách khác nhau
        const elementExists = await page.evaluate(selector => {
          return document.querySelector(selector) !== null;
        }, step.selector);
        
        if (!elementExists) {
          console.log(`Không tìm thấy phần tử với selector ${step.selector}, thử các selector thay thế...`);
          
          // Phân tích selector để tìm selector thay thế
          // Ví dụ: chuyển từ input[name='q'] sang textarea[name='q'] hoặc [name='q']
          const alternativeSelectors = [
            // Loại bỏ input/ nếu có
            step.selector.replace(/^input/, ''),
            // Thử với textarea thay vì input
            step.selector.replace(/^input/, 'textarea'),
            // Thử chỉ với thuộc tính name
            `[name='${step.selector.match(/name=['"]([^'"]+)['"]/)?.[1] || ''}']`,
            // Thử chỉ với thuộc tính id
            `#${step.selector.match(/id=['"]([^'"]+)['"]/)?.[1] || ''}`,
            // Thử với các trường tìm kiếm phổ biến
            'input[type="search"]',
            'input.search',
            'input.searchbox',
            'textarea.searchbox',
            '[role="search"] input',
            '[role="search"] textarea'
          ];
          
          const foundSelector = await page.evaluate((selectors) => {
            for (const sel of selectors) {
              if (sel && document.querySelector(sel)) {
                return sel;
              }
            }
            return null;
          }, alternativeSelectors);
          
          if (foundSelector) {
            console.log(`Đã tìm thấy phần tử thay thế với selector: ${foundSelector}`);
            // Cập nhật selector mới tìm thấy
            step.selector = foundSelector;
          } else {
            console.error(`Không thể tìm thấy phần tử nhập liệu thay thế`);
            throw new Error(`Không tìm thấy phần tử nhập liệu với selector ${step.selector} hoặc các selector thay thế`);
          }
        }
        
        // Xóa nội dung hiện tại của trường (nếu có)
        await page.evaluate(selector => {
          const element = document.querySelector(selector);
          if (element) {
            element.value = '';
          }
        }, step.selector);
        
        // Thực hiện nhập liệu
        await page.type(step.selector, step.value, { delay: 50 });
        
        // Xác minh ngay lập tức giá trị đã nhập
        const inputValue = await page.evaluate(selector => {
          const element = document.querySelector(selector);
          return element ? element.value : null;
        }, step.selector);
        
        if (!inputValue || !inputValue.includes(step.value)) {
          throw new Error(`Không thể xác minh giá trị đã nhập. Giá trị hiện tại: "${inputValue}"`);
        }
        
        console.log(`Đã nhập thành công: "${step.value}" vào ${step.selector}`);
      } catch (error) {
        console.error(`Lỗi khi nhập dữ liệu:`, error);
        throw error;
      }
      break;
    case 'click':
      await page.click(step.selector);
      break;
    case 'select':
      await page.select(step.selector, step.value);
      break;
    case 'wait':
      await page.waitForTimeout(parseInt(step.value) || 1000);
      break;
    case 'waitForSelector':
      await page.waitForSelector(step.selector, { visible: true });
      break;
    case 'navigate':
      await page.goto(step.value, { waitUntil: 'networkidle2' });
      break;
    case 'screenshot':
      const ssPath = path.join(__dirname, '../public/screenshots', `step_${Date.now()}.png`);
      await page.screenshot({ path: ssPath });
      console.log(`Đã chụp ảnh bước tại: ${ssPath}`);
      break;
    case 'pressKey':
      await page.keyboard.press(step.value);
      break;
    case 'clickText':
      // Sử dụng XPath để tìm phần tử chứa text
      await page.evaluate((text) => {
        const elements = document.evaluate(
          `//*[contains(text(), "${text}")]`,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );
        
        for (let i = 0; i < elements.snapshotLength; i++) {
          const element = elements.snapshotItem(i);
          if (element && element.click) {
            element.click();
            return;
          }
        }
      }, step.value);
      break;
    default:
      console.log(`Hành động không được hỗ trợ: ${step.action}`);
  }
}

// Hàm xử lý captcha cải tiến
async function handleCaptchaIfPresent(page) {
  try {
    // Kiểm tra xem có captcha trên trang không
    const captchaDetected = await detectCaptcha(page);
    
    if (captchaDetected) {
      console.log('⚠️ Phát hiện CAPTCHA!');
      
      // Chụp ảnh captcha để xem xét
      const captchaScreenshotPath = path.join(__dirname, '../public/screenshots', `captcha_${Date.now()}.png`);
      await page.screenshot({ path: captchaScreenshotPath, fullPage: true });
      console.log(`Đã chụp ảnh captcha tại: ${captchaScreenshotPath}`);
      
      // Thông báo cho người dùng
      console.log('Đang chờ người dùng hoặc các giải pháp tự động xử lý captcha...');
      
      // Chờ 10 giây ban đầu như yêu cầu
      await page.waitForTimeout(10000);
      
      // Kiểm tra lại xem captcha còn không
      let captchaStillPresent = await detectCaptcha(page);
      let waitAttempts = 1;
      const maxWaitAttempts = 12; // Chờ tối đa 2 phút (12 lần x 10 giây)
      
      while (captchaStillPresent && waitAttempts < maxWaitAttempts) {
        console.log(`Captcha vẫn hiện diện sau ${waitAttempts * 10} giây. Tiếp tục chờ...`);
        await page.waitForTimeout(10000); // Chờ thêm 10 giây
        captchaStillPresent = await detectCaptcha(page);
        waitAttempts++;
      }
      
      // Chụp ảnh sau khi xử lý để so sánh
      const afterCaptchaPath = path.join(__dirname, '../public/screenshots', `after_captcha_${Date.now()}.png`);
      await page.screenshot({ path: afterCaptchaPath, fullPage: true });
      
      if (!captchaStillPresent) {
        console.log('✅ Captcha đã được xử lý thành công, tiếp tục thực hiện.');
        return true;
      } else {
        console.log('⚠️ Đã chờ quá thời gian tối đa nhưng captcha vẫn chưa được xử lý.');
        // Có thể thêm xử lý đặc biệt ở đây, ví dụ thông báo cho người dùng
        return false;
      }
    }
    
    return true; // Không có captcha
  } catch (error) {
    console.error('Lỗi khi xử lý captcha:', error);
    return false; // Giả định rằng có vấn đề với captcha nếu có lỗi
  }
}

// Hàm phát hiện captcha trên trang cải tiến
async function detectCaptcha(page) {
  return await page.evaluate(() => {
    // Kiểm tra Google reCAPTCHA
    const hasRecaptchaIframe = !!document.querySelector('iframe[src*="recaptcha"]');
    const hasRecaptchaDiv = !!document.querySelector('.g-recaptcha');
    const hasSiteKey = !!document.querySelector('[data-sitekey]');
    
    // Kiểm tra hCaptcha
    const hasHcaptchaIframe = !!document.querySelector('iframe[src*="hcaptcha"]');
    const hasHcaptchaDiv = !!document.querySelector('.h-captcha');
    
    // Kiểm tra các yếu tố dựa trên ID/class cụ thể
    const hasCaptchaId = !!document.querySelector('#captcha');
    const hasCaptchaClass = !!document.querySelector('.captcha');
    const hasIdWithCaptcha = !!document.querySelector('[id*="captcha" i]');
    const hasClassWithCaptcha = !!document.querySelector('[class*="captcha" i]');
    
    // Phân tích text để phát hiện captcha - cần thận trọng để tránh false positives
    let hasTextMentioningCaptcha = false;
    
    // Chỉ kiểm tra text trong các phần tử hiển thị và có kích thước hợp lý
    const visibleElements = Array.from(document.querySelectorAll('h1, h2, h3, h4, p, label, div.alert, .popup, .modal, .dialog, [role="dialog"]'))
      .filter(el => {
        // Kiểm tra xem phần tử có hiển thị không
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && 
               rect.height > 0 && 
               style.display !== 'none' && 
               style.visibility !== 'hidden' && 
               style.opacity !== '0';
      });
    
    // Tìm kiếm từ "captcha" trong text của các phần tử hiển thị
    for (const el of visibleElements) {
      const text = el.innerText || el.textContent;
      if (text && text.toLowerCase().includes('captcha')) {
        hasTextMentioningCaptcha = true;
        break;
      }
    }
    
    // Kiểm tra các hình ảnh captcha
    const hasCaptchaImage = !!document.querySelector('img[src*="captcha" i]');
    
    // Kiểm tra thẻ canvas (thường được sử dụng trong captcha tùy chỉnh)
    const hasCanvas = document.querySelectorAll('canvas').length > 0 && (hasTextMentioningCaptcha || hasClassWithCaptcha);
    
    // Kiểm tra các yếu tố phổ biến khác
    const hasVerifyText = Array.from(visibleElements).some(el => {
      const text = el.innerText || el.textContent;
      return text && (
        text.toLowerCase().includes('i\'m not a robot') ||
        text.toLowerCase().includes('tôi không phải là robot') ||
        text.toLowerCase().includes('xác minh bạn là người') ||
        text.toLowerCase().includes('verify you are human')
      );
    });
    
    // Ghi log chi tiết để debug
    console.log('Kết quả phát hiện captcha:', {
      recaptcha: hasRecaptchaIframe || hasRecaptchaDiv || hasSiteKey,
      hcaptcha: hasHcaptchaIframe || hasHcaptchaDiv,
      captchaIdClass: hasCaptchaId || hasCaptchaClass || hasIdWithCaptcha || hasClassWithCaptcha,
      captchaText: hasTextMentioningCaptcha,
      captchaImage: hasCaptchaImage,
      canvas: hasCanvas,
      verifyText: hasVerifyText
    });
    
    // Combine all checks
    return (
      // Google reCAPTCHA
      hasRecaptchaIframe || hasRecaptchaDiv || hasSiteKey ||
      // hCaptcha
      hasHcaptchaIframe || hasHcaptchaDiv ||
      // ID/Class specific
      hasCaptchaId || hasCaptchaClass ||
      // More specific combinations (to reduce false positives)
      (hasTextMentioningCaptcha && (hasIdWithCaptcha || hasClassWithCaptcha || hasCaptchaImage)) ||
      // Tìm thấy canvas kết hợp với text hoặc class liên quan 
      hasCanvas ||
      // Phát hiện text "I'm not a robot" và tương tự
      hasVerifyText
    );
  });
}

module.exports = {
  executeInstructions
}; 
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Khởi tạo Generative AI với API key từ biến môi trường
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Phân tích yêu cầu ban đầu và đề xuất bước đầu tiên
async function analyzeRequest(request) {
  console.log('Phân tích yêu cầu với Gemini:', request);
  
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    const prompt = `
    Hãy phân tích yêu cầu sau đây và đề xuất bước đầu tiên cần thực hiện để tự động hóa trình duyệt:
    "${request}"
    
    Trả về kết quả dưới dạng JSON với định dạng sau:
    {
      "url": "URL trang web bắt đầu cần truy cập",
      "nextStep": {
        "action": "type/click/select/wait/...",
        "selector": "CSS selector của phần tử (nếu cần)",
        "value": "Giá trị cần nhập (nếu cần)",
        "description": "Mô tả hành động này"
      }
    }
    
    Chỉ trả về JSON, không có giải thích thêm.
    `;
    
    console.log('Đang gửi prompt khởi đầu đến Gemini...');
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    console.log('Phản hồi từ Gemini:', text);
    
    try {
      const jsonStr = text.replace(/```json|```/g, '').trim();
      return JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('Lỗi phân tích JSON:', parseError);
      throw new Error('Không thể phân tích phản hồi từ Gemini');
    }
  } catch (error) {
    console.error('Lỗi khi gọi Gemini API:', error);
    throw error;
  }
}

// Quyết định bước tiếp theo dựa trên trạng thái hiện tại
async function decideNextStep(request, currentState, previousSteps = [], pageStructure = null) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    // Tạo log của các bước trước đó
    const previousStepsLog = previousSteps.map((step, index) => 
      `Bước ${index + 1}: ${step.description} - Kết quả: ${step.result || 'Thành công'}`
    ).join('\n');

    // Chuẩn bị thông tin về cấu trúc trang
    let pageStructureInfo = '';
    if (pageStructure) {
      pageStructureInfo = `
Cấu trúc trang web hiện tại:

Forms (${pageStructure.forms.length}):
${pageStructure.forms.map(form => `- Form ${form.id ? `id="${form.id}"` : `#${form.index}`} với ${form.fields.length} trường
  ${form.fields.map(field => `  + ${field.type} ${field.name ? `name="${field.name}"` : ''} ${field.placeholder ? `placeholder="${field.placeholder}"` : ''} ${field.isRequired ? '(bắt buộc)' : ''} selector="${field.selector}"`).join('\n  ')}`).join('\n')}

Buttons (${pageStructure.buttons.length}):
${pageStructure.buttons.map(btn => `- Button "${btn.text || 'Không có text'}" ${btn.id ? `id="${btn.id}"` : ''} selector="${btn.selector}"`).join('\n')}

Inputs ngoài form (${pageStructure.inputs.length}):
${pageStructure.inputs.map(input => `- ${input.type} ${input.name ? `name="${input.name}"` : ''} ${input.placeholder ? `placeholder="${input.placeholder}"` : ''} selector="${input.selector}"`).join('\n')}

Links (${pageStructure.links.length > 10 ? '10 links đầu tiên' : `${pageStructure.links.length} links`}):
${pageStructure.links.slice(0, 10).map(link => `- Link "${link.text || 'Không có text'}" href="${link.href}" selector="${link.selector}"`).join('\n')}

Nội dung chính:
${pageStructure.mainContent.slice(0, 5).map(content => `- ${content.tag}: "${content.text.substring(0, 100)}${content.text.length > 100 ? '...' : ''}"`).join('\n')}
`;
    }

    const prompt = `
    Yêu cầu tự động hóa: "${request}"
    
    Trạng thái hiện tại: 
    - URL: ${currentState.url}
    - Tiêu đề: ${currentState.title}
    
    Các bước đã thực hiện:
    ${previousStepsLog}
    
    ${pageStructureInfo}
    
    Dựa vào thông tin trên, hãy quyết định bước tiếp theo để hoàn thành yêu cầu.
    Sử dụng các selector CSS hoặc XPath chính xác từ cấu trúc trang để tương tác với các phần tử.
    
    Các loại hành động có thể thực hiện:
    - type: Nhập text vào một trường
    - click: Nhấp vào một phần tử
    - select: Chọn một option trong dropdown
    - wait: Chờ một khoảng thời gian (mili giây)
    - waitForSelector: Chờ cho đến khi một phần tử xuất hiện
    - navigate: Điều hướng đến một URL mới
    - pressKey: Nhấn phím (Enter, Tab, Escape,...)
    - clickText: Tìm và nhấp vào phần tử chứa text
    
    Nếu yêu cầu đã hoàn thành, hãy trả về "completed": true.
    
    Trả về kết quả dưới dạng JSON:
    {
      "completed": false,
      "nextStep": {
        "action": "type/click/select/wait/...",
        "selector": "CSS selector hoặc XPath của phần tử (nếu cần)",
        "value": "Giá trị cần nhập (nếu cần)",
        "description": "Mô tả hành động này"
      }
    }
    
    HOẶC nếu đã hoàn thành:
    
    {
      "completed": true,
      "summary": "Tóm tắt các hành động đã thực hiện"
    }
    
    Chỉ trả về JSON, không có giải thích thêm.
    `;
    
    console.log('Đang yêu cầu Gemini quyết định bước tiếp theo...');
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    console.log('Phản hồi từ Gemini:', text);
    
    try {
      const jsonStr = text.replace(/```json|```/g, '').trim();
      return JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('Lỗi phân tích JSON:', parseError);
      throw new Error('Không thể phân tích phản hồi từ Gemini');
    }
  } catch (error) {
    console.error('Lỗi khi gọi Gemini API:', error);
    throw error;
  }
}

// Thêm phương thức mới để phân tích HTML
async function analyzeHTMLStructure(html, currentState, errorContext) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    const prompt = `
    Phân tích đoạn HTML dưới đây và giúp tôi tìm ra phần tử nhập liệu hoặc tương tác phù hợp.
    
    Trạng thái hiện tại: 
    - URL: ${currentState.url}
    - Tiêu đề: ${currentState.title}
    
    Vấn đề gặp phải: ${errorContext}
    
    HTML:
    \`\`\`html
    ${html.substring(0, 10000)}
    \`\`\`
    
    Hãy giúp tôi:
    1. Xác định selector CSS chính xác cho phần tử tìm kiếm/nhập liệu
    2. Phân tích cấu trúc trang để giúp tôi hiểu cách tương tác với nó
    3. Đề xuất phương pháp thay thế nếu selector thông thường không hoạt động
    
    Trả về kết quả dưới dạng JSON:
    {
      "analysis": "Phân tích về cấu trúc của trang web",
      "recommendedSelector": "Selector CSS được đề xuất để tương tác",
      "alternativeSelectors": ["Selector thay thế 1", "Selector thay thế 2"],
      "interactionMethod": "Phương pháp tương tác được đề xuất (click, type, etc.)",
      "javascriptFallback": "Code JavaScript có thể sử dụng để tương tác trực tiếp nếu Puppeteer thất bại"
    }
    `;
    
    console.log('Đang yêu cầu Gemini phân tích HTML...');
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    try {
      const jsonStr = text.replace(/```json|```/g, '').trim();
      return JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('Lỗi phân tích JSON:', parseError);
      return {
        analysis: "Không thể phân tích phản hồi từ Gemini",
        recommendedSelector: null
      };
    }
  } catch (error) {
    console.error('Lỗi khi gọi Gemini API để phân tích HTML:', error);
    return {
      analysis: "Lỗi khi phân tích HTML",
      recommendedSelector: null
    };
  }
}

// Phương thức mới để quyết định bước tiếp theo với HTML đầy đủ
async function decideNextStepWithHTML(request, currentState, previousSteps = [], pageStructure = null, fullHTML = '') {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    // Tạo log của các bước trước đó
    const previousStepsLog = previousSteps.map((step, index) => 
      `Bước ${index + 1}: ${step.description} - Kết quả: ${step.result || 'Thành công'}`
    ).join('\n');

    // Chuẩn bị thông tin về cấu trúc trang
    let pageStructureInfo = '';
    if (pageStructure) {
      pageStructureInfo = `
Cấu trúc trang web hiện tại:

Forms (${pageStructure.forms.length}):
${pageStructure.forms.map(form => `- Form ${form.id ? `id="${form.id}"` : `#${form.index}`} với ${form.fields.length} trường
  ${form.fields.map(field => `  + ${field.type} ${field.name ? `name="${field.name}"` : ''} ${field.placeholder ? `placeholder="${field.placeholder}"` : ''} ${field.isRequired ? '(bắt buộc)' : ''} selector="${field.selector}"`).join('\n  ')}`).join('\n')}

Buttons (${pageStructure.buttons.length}):
${pageStructure.buttons.map(btn => `- Button "${btn.text || 'Không có text'}" ${btn.id ? `id="${btn.id}"` : ''} selector="${btn.selector}"`).join('\n')}

Inputs ngoài form (${pageStructure.inputs.length}):
${pageStructure.inputs.map(input => `- ${input.type} ${input.name ? `name="${input.name}"` : ''} ${input.placeholder ? `placeholder="${input.placeholder}"` : ''} selector="${input.selector}"`).join('\n')}

Links (${pageStructure.links.length > 10 ? '10 links đầu tiên' : `${pageStructure.links.length} links`}):
${pageStructure.links.slice(0, 10).map(link => `- Link "${link.text || 'Không có text'}" href="${link.href}" selector="${link.selector}"`).join('\n')}

${pageStructure.searchBoxes && pageStructure.searchBoxes.length > 0 ? `
Search boxes (${pageStructure.searchBoxes.length}):
${pageStructure.searchBoxes.map(search => `- ${search.type} ${search.placeholder ? `placeholder="${search.placeholder}"` : ''} selector="${search.selector}"`).join('\n')}
` : ''}

Nội dung chính:
${pageStructure.mainContent.slice(0, 5).map(content => `- ${content.tag}: "${content.text.substring(0, 100)}${content.text.length > 100 ? '...' : ''}"`).join('\n')}
`;
    }

    // Chuẩn bị trích đoạn HTML để phân tích
    const htmlInfo = `
HTML hiện tại (trích đoạn đầu và các phần quan trọng):
\`\`\`html
${fullHTML.substring(0, 7000)}
...
\`\`\`
`;

    const prompt = `
    Yêu cầu tự động hóa: "${request}"
    
    Trạng thái hiện tại: 
    - URL: ${currentState.url}
    - Tiêu đề: ${currentState.title}
    
    Các bước đã thực hiện:
    ${previousStepsLog}
    
    ${pageStructureInfo}
    
    ${htmlInfo}
    
    Dựa vào thông tin trên và HTML hiện tại, hãy quyết định bước tiếp theo để hoàn thành yêu cầu.
    Sử dụng các selector CSS hoặc XPath chính xác từ cấu trúc trang để tương tác với các phần tử.
    
    Các loại hành động có thể thực hiện:
    - type: Nhập text vào một trường
    - click: Nhấp vào một phần tử
    - select: Chọn một option trong dropdown
    - wait: Chờ một khoảng thời gian (mili giây)
    - waitForSelector: Chờ cho đến khi một phần tử xuất hiện
    - navigate: Điều hướng đến một URL mới
    - pressKey: Nhấn phím (Enter, Tab, Escape,...)
    - clickText: Tìm và nhấp vào phần tử chứa text
    
    Nếu yêu cầu đã hoàn thành, hãy trả về "completed": true.
    
    Trả về kết quả dưới dạng JSON:
    {
      "completed": false,
      "nextStep": {
        "action": "type/click/select/wait/...",
        "selector": "CSS selector hoặc XPath của phần tử (nếu cần)",
        "value": "Giá trị cần nhập (nếu cần)",
        "description": "Mô tả hành động này"
      }
    }
    
    HOẶC nếu đã hoàn thành:
    
    {
      "completed": true,
      "summary": "Tóm tắt các hành động đã thực hiện"
    }
    
    Chỉ trả về JSON, không có giải thích thêm.
    `;
    
    console.log('Đang yêu cầu Gemini quyết định bước tiếp theo với HTML đầy đủ...');
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    console.log('Phản hồi từ Gemini:', text);
    
    try {
      const jsonStr = text.replace(/```json|```/g, '').trim();
      return JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('Lỗi phân tích JSON:', parseError);
      throw new Error('Không thể phân tích phản hồi từ Gemini');
    }
  } catch (error) {
    console.error('Lỗi khi gọi Gemini API:', error);
    throw error;
  }
}

module.exports = {
  analyzeRequest,
  decideNextStep,
  analyzeHTMLStructure,
  decideNextStepWithHTML
}; 
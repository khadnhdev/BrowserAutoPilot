require('dotenv').config();
const express = require('express');
const path = require('path');
const geminiService = require('./services/geminiService');
const browserService = require('./services/browserService');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Routes
app.get('/', (req, res) => {
  res.render('index');
});

app.post('/execute', async (req, res) => {
  try {
    const { request } = req.body;
    console.log(`Nhận yêu cầu từ người dùng: "${request}"`);

    // Phân tích yêu cầu ban đầu bằng Gemini
    console.log('Đang phân tích yêu cầu bằng Gemini...');
    const initialInstructions = await geminiService.analyzeRequest(request);
    console.log('Kết quả phân tích ban đầu:', initialInstructions);

    // Thực hiện tự động hóa trình duyệt theo quy trình từng bước
    console.log('Bắt đầu tự động hóa trình duyệt...');
    const result = await browserService.executeInstructions(initialInstructions, request);
    console.log('Hoàn thành tự động hóa trình duyệt');

    res.render('result', { 
      request, 
      steps: result.steps, 
      screenshotPath: result.screenshotPath 
    });
  } catch (error) {
    console.error('Lỗi:', error);
    res.status(500).render('error', { error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
}); 
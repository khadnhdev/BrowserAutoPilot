const fs = require('fs');
const path = require('path');

const screenshotsDir = path.join(__dirname, 'public', 'screenshots');

if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
  console.log('Đã tạo thư mục screenshots');
} else {
  console.log('Thư mục screenshots đã tồn tại');
} 
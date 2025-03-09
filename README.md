# Ứng dụng Tự động hóa Web với AI

Ứng dụng web giúp người dùng tự động hóa các thao tác trên trình duyệt chỉ bằng cách mô tả bằng ngôn ngữ tự nhiên.

## Tính năng

- Điều khiển trình duyệt tự động dựa trên mô tả bằng tiếng Việt
- Chụp ảnh quá trình thực hiện
- Ghi lại chi tiết từng bước

## Cài đặt

1. Clone repository
2. Cài đặt dependencies:
   ```
   npm install
   ```
3. Tạo file `.env` với nội dung:
   ```
   GEMINI_API_KEY=your_api_key_here
   ```
4. Chạy ứng dụng:
   ```
   npm start
   ```
5. Truy cập `http://localhost:3000`

## Cách sử dụng

1. Nhập mô tả hành động bạn muốn tự động hóa (ví dụ: "Vào Google, tìm kiếm thời tiết Hà Nội")
2. Nhấn "Bắt đầu tự động hóa"
3. Xem trình duyệt thực hiện tự động và kết quả

## Yêu cầu

- Node.js
- Chrome hoặc Chromium
- API key của Google Gemini

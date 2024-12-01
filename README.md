# Random Video Chat Application

A real-time video chat application that allows users to connect with random strangers, similar to Omegle.

## Features

- Random user matching
- Real-time video chat
- Text chat functionality
- Toggle video on/off
- Responsive design

## Technology Stack

- Backend: Python (Flask)
- Frontend: HTML, CSS, JavaScript
- WebSocket: Flask-SocketIO
- Video: WebRTC

## Installation

1. Clone the repository
2. Install dependencies:
   ```
   pip install -r requirements.txt
   ```
3. Run the application:
   ```
   python app.py
   ```

## Usage

1. Open the application in your browser
2. Allow camera and microphone access when prompted
3. Wait to be matched with another user
4. Use the "Toggle Video" button to enable/disable video
5. Type messages in the chat box to communicate via text

## Deployment

This application is configured for deployment on Render.com using Gunicorn with eventlet workers.

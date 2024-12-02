web: gunicorn --worker-class geventwebsocket.gunicorn.workers.GeventWebSocketWorker --workers 1 --bind 0.0.0.0:$PORT --log-level debug --timeout 120 --worker-connections 1000 --preload app:app

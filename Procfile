web: gunicorn --worker-class geventwebsocket.gunicorn.workers.GeventWebSocketWorker --workers 1 --threads 1000 --bind 0.0.0.0:$PORT --timeout 120 --keep-alive 5 --log-level debug app:app

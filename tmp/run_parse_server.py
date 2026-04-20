import sys
sys.path.insert(0, r"C:\ForkVerse")
from http.server import HTTPServer
from api.parse import handler
server = HTTPServer(("127.0.0.1", 8124), handler)
print("SERVING", flush=True)
server.serve_forever()

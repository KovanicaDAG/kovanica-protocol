import asyncio
import json
import sqlite3
import datetime

UPSTREAM_HOST = "stratum.antpool.com"
UPSTREAM_PORT = 3333

DB_PATH = "shares.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS shares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        worker_name TEXT NOT NULL,
        algo TEXT NOT NULL,
        shares INTEGER NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )''')
    conn.commit()
    conn.close()

def log_share(worker_name, algo="sha256"):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("INSERT INTO shares (worker_name, algo, shares) VALUES (?, ?, ?)", (worker_name, algo, 1))
    conn.commit()
    conn.close()

async def handle_client(reader, writer):
    try:
        upstream_reader, upstream_writer = await asyncio.open_connection(UPSTREAM_HOST, UPSTREAM_PORT)
    except Exception as e:
        print(f"Failed to connect to upstream: {e}")
        writer.close()
        return

    async def forward_client_to_upstream():
        try:
            while True:
                data = await reader.readline()
                if not data:
                    break
                
                try:
                    msg = json.loads(data.decode('utf-8'))
                    if msg.get("method") == "mining.submit":
                        worker_name = msg.get("params", ["unknown"])[0]
                        print(f"Share submitted by {worker_name}")
                        log_share(worker_name)
                except json.JSONDecodeError:
                    pass
                except Exception as e:
                    print(f"Error parsing client message: {e}")
                
                upstream_writer.write(data)
                await upstream_writer.drain()
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"Client to upstream error: {e}")
        finally:
            upstream_writer.close()
            writer.close()

    async def forward_upstream_to_client():
        try:
            while True:
                data = await upstream_reader.read(4096)
                if not data:
                    break
                writer.write(data)
                await writer.drain()
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"Upstream to client error: {e}")
        finally:
            writer.close()
            upstream_writer.close()

    task1 = asyncio.create_task(forward_client_to_upstream())
    task2 = asyncio.create_task(forward_upstream_to_client())
    
    await asyncio.gather(task1, task2, return_exceptions=True)

async def main():
    init_db()
    server = await asyncio.start_server(handle_client, '0.0.0.0', 3333)
    addr = server.sockets[0].getsockname()
    print(f'Serving on {addr}')

    async with server:
        await server.serve_forever()

if __name__ == '__main__':
    asyncio.run(main())

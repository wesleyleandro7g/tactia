"""Local development bridge from the host to the isolated runtime API."""

import asyncio


async def copy(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    try:
        while chunk := await reader.read(64 * 1024):
            writer.write(chunk)
            await writer.drain()
    except (ConnectionError, OSError):
        pass


async def handle(client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter):
    try:
        runtime_reader, runtime_writer = await asyncio.open_connection("browser-runtime", 8765)
        await asyncio.gather(copy(client_reader, runtime_writer), copy(runtime_reader, client_writer))
        runtime_writer.close()
        await runtime_writer.wait_closed()
    finally:
        client_writer.close()
        await client_writer.wait_closed()


async def main():
    server = await asyncio.start_server(handle, "0.0.0.0", 8765)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())

#!/usr/bin/env python3
"""
Database Proxy Bridge for WSL PostgreSQL Access

This script creates a TCP proxy that forwards connections from a local port
to the PostgreSQL database running in WSL, allowing Next.js applications
running on Windows to access the WSL database seamlessly.

Usage:
    python database-proxy.py

The proxy will listen on 127.0.0.1:5432 (or configured port) and forward
all connections to the WSL PostgreSQL instance.
"""

import socket
import threading
import time
import argparse
import sys
import subprocess
import logging
from typing import Optional

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('database-proxy.log')
    ]
)
logger = logging.getLogger(__name__)

class DatabaseProxy:
    def __init__(self, local_host: str = '0.0.0.0', local_port: int = 5432,
                 remote_host: str = None, remote_port: int = 5432):
        """
        Initialize the database proxy.

        Args:
            local_host: Local interface to bind to (default: 0.0.0.0 for external access)
            local_port: Local port to listen on (default: 5432)
            remote_host: Remote host to forward to (auto-detected WSL IP if None)
            remote_port: Remote port to forward to (default: 5432)
        """
        self.local_host = local_host
        self.local_port = local_port
        self.remote_host = remote_host or self._detect_wsl_ip()
        self.remote_port = remote_port
        self.server_socket: Optional[socket.socket] = None
        self.running = False

        logger.info(f"Database Proxy initialized:")
        logger.info(f"  Listening on: {local_host}:{local_port}")
        logger.info(f"  Forwarding to: {self.remote_host}:{remote_port}")

    def _detect_wsl_ip(self) -> str:
        """Auto-detect the WSL IP address."""
        try:
            # Try to get WSL IP using hostname command
            result = subprocess.run(['wsl', 'hostname', '-I'],
                                  capture_output=True, text=True, timeout=5)

            if result.returncode == 0 and result.stdout.strip():
                wsl_ip = result.stdout.strip().split()[0]  # Take first IP
                logger.info(f"Auto-detected WSL IP: {wsl_ip}")
                return wsl_ip
            else:
                logger.warning("Could not auto-detect WSL IP, using default 172.30.209.31")
                return "172.30.209.31"

        except (subprocess.TimeoutExpired, subprocess.SubprocessError, FileNotFoundError) as e:
            logger.warning(f"Could not detect WSL IP: {e}, using default 172.30.209.31")
            return "172.30.209.31"

    def _test_connection(self, host: str, port: int, timeout: float = 2.0) -> bool:
        """Test if a connection to host:port is possible."""
        try:
            test_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            test_socket.settimeout(timeout)
            result = test_socket.connect_ex((host, port))
            test_socket.close()
            return result == 0
        except Exception as e:
            logger.debug(f"Connection test failed: {e}")
            return False

    def _handle_client(self, client_socket: socket.socket, client_address: tuple):
        """Handle a client connection by forwarding it to the remote server."""
        remote_socket = None
        client_ip, client_port = client_address

        try:
            logger.debug(f"New connection from {client_ip}:{client_port}")

            # Connect to remote server
            remote_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            remote_socket.connect((self.remote_host, self.remote_port))
            logger.debug(f"Connected to remote {self.remote_host}:{self.remote_port}")

            # Set up bidirectional forwarding
            def forward(source, destination, direction):
                try:
                    while True:
                        data = source.recv(4096)
                        if not data:
                            break
                        destination.sendall(data)
                except Exception as e:
                    logger.debug(f"Forwarding error ({direction}): {e}")

            # Start forwarding threads
            client_to_remote = threading.Thread(
                target=forward,
                args=(client_socket, remote_socket, "client->remote"),
                daemon=True
            )
            remote_to_client = threading.Thread(
                target=forward,
                args=(remote_socket, client_socket, "remote->client"),
                daemon=True
            )

            client_to_remote.start()
            remote_to_client.start()

            # Wait for either direction to close
            client_to_remote.join()
            remote_to_client.join()

        except Exception as e:
            logger.error(f"Error handling client {client_address}: {e}")
        finally:
            try:
                client_socket.close()
            except:
                pass
            try:
                if remote_socket:
                    remote_socket.close()
            except:
                pass
            logger.debug(f"Closed connection from {client_ip}:{client_port}")

    def start(self):
        """Start the proxy server."""
        try:
            self.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self.server_socket.bind((self.local_host, self.local_port))
            self.server_socket.listen(5)
            self.running = True

            logger.info(f"Database proxy started on {self.local_host}:{self.local_port}")
            logger.info(f"Forwarding to {self.remote_host}:{self.remote_port}")
            logger.info("Press Ctrl+C to stop")

            while self.running:
                try:
                    client_socket, client_address = self.server_socket.accept()
                    # Handle each client in a separate thread
                    client_thread = threading.Thread(
                        target=self._handle_client,
                        args=(client_socket, client_address),
                        daemon=True
                    )
                    client_thread.start()

                except KeyboardInterrupt:
                    logger.info("Received shutdown signal")
                    break
                except Exception as e:
                    logger.error(f"Error accepting connection: {e}")

        except Exception as e:
            logger.error(f"Failed to start proxy: {e}")
        finally:
            self.stop()

    def stop(self):
        """Stop the proxy server."""
        self.running = False
        if self.server_socket:
            try:
                self.server_socket.close()
            except:
                pass
        logger.info("Database proxy stopped")

    def health_check(self) -> dict:
        """Perform a health check and return status."""
        local_ok = self._test_connection(self.local_host, self.local_port, 1.0)
        remote_ok = self._test_connection(self.remote_host, self.remote_port, 2.0)

        status = {
            "proxy_running": self.running,
            "local_port_open": local_ok,
            "remote_reachable": remote_ok,
            "local_host": self.local_host,
            "local_port": self.local_port,
            "remote_host": self.remote_host,
            "remote_port": self.remote_port
        }

        if not remote_ok:
            status["warning"] = "Cannot reach remote PostgreSQL server"

        return status


def main():
    parser = argparse.ArgumentParser(description='Database Proxy for WSL PostgreSQL Access')
    parser.add_argument('--local-host', default='0.0.0.0', help='Local host to bind to (0.0.0.0 for external access)')
    parser.add_argument('--local-port', type=int, default=5432, help='Local port to listen on')
    parser.add_argument('--remote-host', help='Remote host to forward to (auto-detects WSL IP if not specified)')
    parser.add_argument('--remote-port', type=int, default=5432, help='Remote port to forward to')
    parser.add_argument('--test', action='store_true', help='Run connection test and exit')
    parser.add_argument('--health', action='store_true', help='Run health check and exit')

    args = parser.parse_args()

    proxy = DatabaseProxy(
        local_host=args.local_host,
        local_port=args.local_port,
        remote_host=args.remote_host,
        remote_port=args.remote_port
    )

    if args.test:
        # Test connections
        print("Testing connections...")
        health = proxy.health_check()
        print(f"Local port ({args.local_host}:{args.local_port}) open: {health['local_port_open']}")
        print(f"Remote server ({proxy.remote_host}:{args.remote_port}) reachable: {health['remote_reachable']}")

        if health['remote_reachable']:
            print("[SUCCESS] All connections look good!")
        else:
            print("[ERROR] Cannot reach remote PostgreSQL server")
            print("Make sure PostgreSQL is running in WSL and firewall allows connections")
        return

    if args.health:
        # Health check
        import json
        health = proxy.health_check()
        print(json.dumps(health, indent=2))
        return

    try:
        proxy.start()
    except KeyboardInterrupt:
        pass
    finally:
        proxy.stop()


if __name__ == '__main__':
    main()

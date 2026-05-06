import fnmatch
import os

import paramiko

from crypto import decrypt
from models.data_source import DataSource


def _connect(ds: DataSource) -> paramiko.SFTPClient:
    transport = paramiko.Transport((ds.sftp_host, ds.sftp_port or 22))
    transport.connect(
        username=ds.sftp_user,
        password=decrypt(ds.sftp_password_enc or ""),
    )
    return paramiko.SFTPClient.from_transport(transport)


def list_files(ds: DataSource) -> list[dict]:
    sftp = _connect(ds)
    try:
        remote_path = ds.sftp_remote_path or "/"
        pattern = ds.sftp_file_pattern or "*"
        entries = sftp.listdir_attr(remote_path)
        return sorted(
            [
                {
                    "name": e.filename,
                    "size": e.st_size,
                    "modified": e.st_mtime,
                }
                for e in entries
                if fnmatch.fnmatch(e.filename, pattern)
            ],
            key=lambda f: f["name"],
        )
    finally:
        sftp.close()


def pull_file(ds: DataSource, filename: str, tmp_dir: str = "/app/tmp") -> str:
    sftp = _connect(ds)
    try:
        remote_dir = (ds.sftp_remote_path or "/").rstrip("/")
        remote_path = f"{remote_dir}/{filename}"
        local_path = os.path.join(tmp_dir, filename)
        sftp.get(remote_path, local_path)
        return local_path
    finally:
        sftp.close()

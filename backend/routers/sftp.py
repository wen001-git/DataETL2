import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import DataSource
from models.data_source import SourceType
from routers.auth import get_current_user
from services import sftp_service
from services.ingest_service import ingest_file

router = APIRouter(prefix="/api/v1/sftp", tags=["sftp"])


def _get_sftp_source(ds_id: int, db: Session) -> DataSource:
    ds = db.get(DataSource, ds_id)
    if not ds:
        raise HTTPException(status_code=404, detail="数据源不存在")
    if ds.source_type != SourceType.sftp:
        raise HTTPException(status_code=400, detail="该数据源不是 SFTP 类型")
    return ds


@router.get("/{ds_id}/list")
def list_files(ds_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    ds = _get_sftp_source(ds_id, db)
    try:
        return sftp_service.list_files(ds)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"SFTP 连接失败: {str(e)}")


class PullRequest(BaseModel):
    filename: str


@router.post("/{ds_id}/pull")
def pull_file(
    ds_id: int,
    body: PullRequest,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    ds = _get_sftp_source(ds_id, db)
    local_path = None
    try:
        local_path = sftp_service.pull_file(ds, body.filename)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"SFTP 下载失败: {str(e)}")
    try:
        return ingest_file(local_path, body.filename, ds.target_raw_table)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"数据入库失败: {str(e)}")
    finally:
        if local_path and os.path.exists(local_path):
            os.unlink(local_path)

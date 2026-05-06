# Failure alert emails sent when any ETL execution finishes with status=failed.
# Non-blocking: all SMTP errors are caught and logged to stderr so a misconfigured
# mail server never prevents the execution result from being returned to the caller.
# Disabled by default (ALERT_EMAIL_ENABLED=false in .env); no email is sent in dev
# unless the operator explicitly enables it and supplies valid SMTP credentials.
import smtplib
import sys
from email.mime.text import MIMEText

from config import get_settings
from models.execution import Execution


def send_failure_alert(exec_rec: Execution, ds_name: str) -> None:
    settings = get_settings()
    if not settings.alert_email_enabled:
        return
    if not settings.alert_to_email or not settings.smtp_host:
        return

    subject = (
        f"[DataETL2] 执行失败 — "
        f"{exec_rec.layer_from.value}→{exec_rec.layer_to.value} @ {ds_name}"
    )
    body = (
        f"执行 ID:    {exec_rec.id}\n"
        f"数据源:    {ds_name}\n"
        f"层级:      {exec_rec.layer_from.value} → {exec_rec.layer_to.value}\n"
        f"开始时间:  {exec_rec.started_at}\n"
        f"结束时间:  {exec_rec.finished_at}\n"
        f"错误信息:  {exec_rec.error_message or '—'}\n"
    )

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = settings.smtp_user or "noreply@dataetl2"
    msg["To"] = settings.alert_to_email

    try:
        if settings.smtp_port == 465:
            server = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=10)
        else:
            server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10)
            server.starttls()
        if settings.smtp_user and settings.smtp_password:
            server.login(settings.smtp_user, settings.smtp_password)
        server.sendmail(msg["From"], [settings.alert_to_email], msg.as_string())
        server.quit()
    except Exception as e:
        # Log but never raise — alert failure must not affect execution result
        print(f"[alert_service] Failed to send email: {e}", file=sys.stderr)

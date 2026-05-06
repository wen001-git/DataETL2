import { useEffect, useState } from 'react'
import {
  Select, Button, Upload, Table, Card, Typography,
  message, Space, Tag, Divider,
} from 'antd'
import { InboxOutlined, CloudUploadOutlined, EyeOutlined, DownloadOutlined, FileExcelOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import client from '../api/client'

const { Title, Text } = Typography
const { Dragger } = Upload
const { Option } = Select

interface DataSource {
  id: number
  name: string
  source_type: string
  target_raw_table: string
}

interface PreviewResult {
  columns: { name: string; dtype: string }[]
  total_rows: number
  sample: Record<string, string>[]
}

interface IngestResult {
  run_id: string
  rows_ingested: number
  columns: string[]
  sample: Record<string, string>[]
}

export default function UploadPage() {
  const [sources, setSources] = useState<DataSource[]>([])
  const [selectedDs, setSelectedDs] = useState<number | null>(null)
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [result, setResult] = useState<IngestResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [ingestLoading, setIngestLoading] = useState(false)
  const [templateLoading, setTemplateLoading] = useState<'excel' | 'csv' | null>(null)

  useEffect(() => {
    client.get('/datasources').then((res) => {
      setSources(res.data.filter((d: DataSource) => d.source_type === 'upload'))
    })
  }, [])

  const handlePreview = async () => {
    if (!fileList[0]?.originFileObj) {
      message.warning('请先选择文件')
      return
    }
    setPreviewLoading(true)
    setPreview(null)
    try {
      const form = new FormData()
      form.append('file', fileList[0].originFileObj as File)
      const res = await client.post('/upload/preview', form)
      setPreview(res.data)
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '预览失败')
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleIngest = async () => {
    if (!selectedDs) { message.warning('请选择数据源'); return }
    if (!fileList[0]?.originFileObj) { message.warning('请选择文件'); return }
    setIngestLoading(true)
    setResult(null)
    try {
      const form = new FormData()
      form.append('file', fileList[0].originFileObj as File)
      const res = await client.post(`/upload/${selectedDs}`, form)
      setResult(res.data)
      message.success(`成功入库 ${res.data.rows_ingested} 行`)
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '入库失败')
    } finally {
      setIngestLoading(false)
    }
  }

  const handleTemplate = async (fmt: 'excel' | 'csv') => {
    if (!selectedDs) return
    setTemplateLoading(fmt)
    try {
      const res = await client.get(`/upload/${selectedDs}/template?format=${fmt}`, {
        responseType: 'blob',
      })
      const ext = fmt === 'excel' ? 'xlsx' : 'csv'
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `upload_template.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      const detail = err?.response?.data ? await err.response.data.text?.() : ''
      let msg = '下载失败'
      try { msg = JSON.parse(detail).detail } catch { /* ignore */ }
      message.error(msg || '下载失败，请先配置字段映射')
    } finally {
      setTemplateLoading(null)
    }
  }

  const previewCols = preview
    ? preview.columns.map((c) => ({
        title: (
          <span>
            {c.name} <Tag style={{ fontSize: 10 }}>{c.dtype}</Tag>
          </span>
        ),
        dataIndex: c.name,
        ellipsis: true,
      }))
    : []

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>文件上传入库</Title>

      <Space direction="vertical" style={{ width: '100%' }} size="large">
        <Card title="1. 选择目标数据源">
          <Select
            style={{ width: 400 }}
            placeholder="选择文件上传类型的数据源"
            value={selectedDs}
            onChange={(dsId: number) => { setSelectedDs(dsId); setResult(null); setPreview(null) }}
          >
            {sources.map((s) => (
              <Option key={s.id} value={s.id}>
                {s.name} <Text type="secondary">→ {s.target_raw_table}</Text>
              </Option>
            ))}
          </Select>
          {selectedDs && (
            <div style={{ marginTop: 12 }}>
              <Text type="secondary" style={{ marginRight: 8 }}>下载数据录入模板：</Text>
              <Button
                size="small"
                icon={<FileExcelOutlined />}
                loading={templateLoading === 'excel'}
                onClick={() => handleTemplate('excel')}
                style={{ marginRight: 8 }}
              >
                Excel 模板（含使用说明）
              </Button>
              <Button
                size="small"
                icon={<DownloadOutlined />}
                loading={templateLoading === 'csv'}
                onClick={() => handleTemplate('csv')}
              >
                CSV 模板
              </Button>
            </div>
          )}
          {sources.length === 0 && (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary">暂无文件上传类型的数据源，请先在「数据源管理」中创建。</Text>
            </div>
          )}
        </Card>

        <Card title="2. 选择文件">
          <Dragger
            accept=".csv,.xlsx,.xls"
            maxCount={1}
            fileList={fileList}
            beforeUpload={() => false}
            onChange={({ fileList: fl }) => {
              setFileList(fl)
              setPreview(null)
              setResult(null)
            }}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">点击或拖拽上传 CSV / Excel 文件</p>
            <p className="ant-upload-hint">支持 .csv、.xlsx、.xls 格式</p>
          </Dragger>

          <Space style={{ marginTop: 12 }}>
            <Button
              icon={<EyeOutlined />}
              onClick={handlePreview}
              loading={previewLoading}
              disabled={fileList.length === 0}
            >
              预览字段
            </Button>
            <Button
              type="primary"
              icon={<CloudUploadOutlined />}
              onClick={handleIngest}
              loading={ingestLoading}
              disabled={!selectedDs || fileList.length === 0}
            >
              确认入库
            </Button>
          </Space>
        </Card>

        {preview && (
          <Card title={`字段预览（共 ${preview.total_rows} 行，显示前 10 行）`}>
            <Table
              rowKey={(_, i) => String(i)}
              dataSource={preview.sample}
              columns={previewCols}
              pagination={false}
              scroll={{ x: 'max-content' }}
              size="small"
            />
          </Card>
        )}

        {result && (
          <Card title="入库结果">
            <Space direction="vertical">
              <Text>Run ID: <code>{result.run_id}</code></Text>
              <Text>入库行数: <strong>{result.rows_ingested}</strong></Text>
              <Text>字段列表: {result.columns.join(', ')}</Text>
              <Divider />
              <Text type="secondary">前 5 行数据：</Text>
              <Table
                rowKey={(_, i) => String(i)}
                dataSource={result.sample}
                columns={result.columns.map((c) => ({ title: c, dataIndex: c, ellipsis: true }))}
                pagination={false}
                scroll={{ x: 'max-content' }}
                size="small"
              />
            </Space>
          </Card>
        )}
      </Space>
    </div>
  )
}

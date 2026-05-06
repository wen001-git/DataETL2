import { useEffect, useState } from 'react'
import {
  Select, Button, Table, Card, Typography,
  message, Space, Tag, Alert,
} from 'antd'
import { ReloadOutlined, CloudDownloadOutlined } from '@ant-design/icons'
import client from '../api/client'

const { Title, Text } = Typography
const { Option } = Select

interface DataSource {
  id: number
  name: string
  source_type: string
  sftp_host: string | null
  sftp_remote_path: string | null
  target_raw_table: string
}

interface RemoteFile {
  name: string
  size: number
  modified: number
}

interface IngestResult {
  run_id: string
  rows_ingested: number
  columns: string[]
}

export default function SftpBrowser() {
  const [sources, setSources] = useState<DataSource[]>([])
  const [selectedDs, setSelectedDs] = useState<number | null>(null)
  const [files, setFiles] = useState<RemoteFile[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [pullingFile, setPullingFile] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<IngestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    client.get('/datasources').then((res) => {
      setSources(res.data.filter((d: DataSource) => d.source_type === 'sftp'))
    })
  }, [])

  const loadFiles = async () => {
    if (!selectedDs) { message.warning('请先选择数据源'); return }
    setListLoading(true)
    setFiles([])
    setError(null)
    try {
      const res = await client.get(`/sftp/${selectedDs}/list`)
      setFiles(res.data)
      if (res.data.length === 0) message.info('远程目录为空或无匹配文件')
    } catch (err: any) {
      const msg = err?.response?.data?.detail || 'SFTP 连接失败'
      setError(msg)
    } finally {
      setListLoading(false)
    }
  }

  const pullFile = async (filename: string) => {
    if (!selectedDs) return
    setPullingFile(filename)
    setLastResult(null)
    try {
      const res = await client.post(`/sftp/${selectedDs}/pull`, { filename })
      setLastResult(res.data)
      message.success(`已入库 ${res.data.rows_ingested} 行`)
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '拉取失败')
    } finally {
      setPullingFile(null)
    }
  }

  const selectedSource = sources.find((s) => s.id === selectedDs)

  const columns = [
    { title: '文件名', dataIndex: 'name' },
    {
      title: '大小',
      dataIndex: 'size',
      render: (v: number) => v > 1048576 ? `${(v / 1048576).toFixed(1)} MB` : `${(v / 1024).toFixed(1)} KB`,
    },
    {
      title: '修改时间',
      dataIndex: 'modified',
      render: (v: number) => new Date(v * 1000).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      render: (_: unknown, record: RemoteFile) => (
        <Button
          type="primary"
          size="small"
          icon={<CloudDownloadOutlined />}
          loading={pullingFile === record.name}
          onClick={() => pullFile(record.name)}
        >
          拉取入库
        </Button>
      ),
    },
  ]

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>SFTP 文件浏览</Title>

      <Space direction="vertical" style={{ width: '100%' }} size="large">
        <Card title="选择 SFTP 数据源">
          <Space>
            <Select
              style={{ width: 380 }}
              placeholder="选择 SFTP 类型的数据源"
              value={selectedDs}
              onChange={(v) => { setSelectedDs(v); setFiles([]); setError(null); setLastResult(null) }}
            >
              {sources.map((s) => (
                <Option key={s.id} value={s.id}>
                  {s.name}
                  <Text type="secondary"> — {s.sftp_host}{s.sftp_remote_path}</Text>
                </Option>
              ))}
            </Select>
            <Button
              icon={<ReloadOutlined />}
              onClick={loadFiles}
              loading={listLoading}
              disabled={!selectedDs}
            >
              连接并浏览
            </Button>
          </Space>

          {selectedSource && (
            <div style={{ marginTop: 12 }}>
              <Text type="secondary">
                目标 Raw 表：<Tag>{selectedSource.target_raw_table}</Tag>
              </Text>
            </div>
          )}

          {sources.length === 0 && (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary">暂无 SFTP 类型的数据源，请先在「数据源管理」中创建。</Text>
            </div>
          )}
        </Card>

        {error && <Alert type="error" message={error} showIcon />}

        {files.length > 0 && (
          <Card title={`远程文件列表（${files.length} 个）`}>
            <Table
              rowKey="name"
              dataSource={files}
              columns={columns}
              pagination={{ pageSize: 20 }}
              size="small"
            />
          </Card>
        )}

        {lastResult && (
          <Card title="最近入库结果">
            <Space direction="vertical">
              <Text>Run ID: <code>{lastResult.run_id}</code></Text>
              <Text>入库行数: <strong>{lastResult.rows_ingested}</strong></Text>
              <Text>字段：{lastResult.columns.join(', ')}</Text>
            </Space>
          </Card>
        )}
      </Space>
    </div>
  )
}

// Execution history page: shows all ETL execution records for a datasource.
// Filters (layer, status) are sent as query params to the backend; frontend handles pagination.
// Status tags: running=blue, success=green, failed=red.
import { useEffect, useState, useCallback } from 'react'
import {
  Select, Button, Table, Space, Card, Typography, Tag, message,
} from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import client from '../api/client'

const { Title, Text } = Typography
const { Option } = Select

interface DataSource {
  id: number
  name: string
  target_raw_table: string
}

interface ExecutionRecord {
  id: number
  data_source_id: number
  layer_from: string
  layer_to: string
  status: string
  rows_success: number
  rows_failed: number
  error_message: string | null
  started_at: string | null
  finished_at: string | null
}

const STATUS_COLOR: Record<string, string> = {
  running: 'blue',
  success: 'green',
  failed: 'red',
}

const LAYER_OPTIONS = [
  { value: 'raw-dwd', label: 'Raw → DWD' },
  { value: 'dwd-dws', label: 'DWD → DWS' },
  { value: 'dws-ads', label: 'DWS → ADS' },
]

function durationSec(rec: ExecutionRecord): string {
  if (!rec.started_at || !rec.finished_at) return '—'
  const ms = new Date(rec.finished_at).getTime() - new Date(rec.started_at).getTime()
  return `${(ms / 1000).toFixed(1)}s`
}

export default function History() {
  const [sources, setSources] = useState<DataSource[]>([])
  const [selectedDs, setSelectedDs] = useState<number | null>(null)
  const [records, setRecords] = useState<ExecutionRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [layerFilter, setLayerFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')

  useEffect(() => {
    client.get('/datasources').then((r) => setSources(r.data))
  }, [])

  const load = useCallback(async (dsId: number, lf: string, sf: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (lf) {
        const parts = lf.split('-')
        params.set('layer_from', parts[0])
        params.set('layer_to', parts[1])
      }
      if (sf) params.set('status', sf)
      const res = await client.get(`/datasources/${dsId}/executions?${params}`)
      setRecords(res.data)
    } catch {
      message.error('加载执行历史失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleDsChange = (dsId: number) => {
    setSelectedDs(dsId)
    setRecords([])
    setLayerFilter('')
    setStatusFilter('')
    load(dsId, '', '')
  }

  const handleFilter = () => {
    if (selectedDs) load(selectedDs, layerFilter, statusFilter)
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    {
      title: '层级',
      width: 140,
      render: (_: any, r: ExecutionRecord) => (
        <Text>{r.layer_from} → {r.layer_to}</Text>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: string) => (
        <Tag color={STATUS_COLOR[v] || 'default'}>{v}</Tag>
      ),
    },
    { title: '成功行数', dataIndex: 'rows_success', width: 90 },
    { title: '失败行数', dataIndex: 'rows_failed', width: 90 },
    {
      title: '开始时间',
      dataIndex: 'started_at',
      width: 180,
      render: (v: string | null) => v ? new Date(v).toLocaleString() : '—',
    },
    {
      title: '耗时',
      width: 80,
      render: (_: any, r: ExecutionRecord) => durationSec(r),
    },
    {
      title: '错误信息',
      dataIndex: 'error_message',
      ellipsis: true,
      render: (v: string | null) => v ? <Text type="danger" style={{ fontSize: 12 }}>{v}</Text> : null,
    },
  ]

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>执行历史</Title>

      <Space direction="vertical" style={{ width: '100%' }} size="large">
        <Card title="1. 选择数据源">
          <Select
            style={{ width: 360 }}
            placeholder="选择数据源"
            value={selectedDs}
            onChange={handleDsChange}
          >
            {sources.map((s) => (
              <Option key={s.id} value={s.id}>
                {s.name}
                <Text type="secondary"> — {s.target_raw_table}</Text>
              </Option>
            ))}
          </Select>
        </Card>

        {selectedDs && (
          <Card
            title="2. 执行记录"
            extra={
              <Space>
                <Select
                  style={{ width: 140 }}
                  placeholder="全部层级"
                  allowClear
                  value={layerFilter || undefined}
                  onChange={(v) => setLayerFilter(v || '')}
                >
                  {LAYER_OPTIONS.map((o) => (
                    <Option key={o.value} value={o.value}>{o.label}</Option>
                  ))}
                </Select>
                <Select
                  style={{ width: 110 }}
                  placeholder="全部状态"
                  allowClear
                  value={statusFilter || undefined}
                  onChange={(v) => setStatusFilter(v || '')}
                >
                  <Option value="running">running</Option>
                  <Option value="success">success</Option>
                  <Option value="failed">failed</Option>
                </Select>
                <Button icon={<ReloadOutlined />} onClick={handleFilter} loading={loading}>
                  筛选
                </Button>
              </Space>
            }
          >
            <Table
              rowKey="id"
              dataSource={records}
              columns={columns}
              loading={loading}
              size="small"
              pagination={{ pageSize: 20, showSizeChanger: false }}
              locale={{ emptyText: '暂无执行记录' }}
            />
          </Card>
        )}
      </Space>
    </div>
  )
}

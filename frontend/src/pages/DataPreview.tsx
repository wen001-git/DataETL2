// Data preview page: browse all 4 ETL layers (raw/dwd/dws/ads) for a datasource.
// Uses server-side pagination — each page change triggers a new API call.
// Table name and total row count are resolved server-side from stored config.
import { useEffect, useState, useCallback } from 'react'
import {
  Select, Card, Typography, Table, Tabs, Space, Tag, message, Alert,
} from 'antd'
import client from '../api/client'

const { Title, Text } = Typography
const { Option } = Select

interface DataSource {
  id: number
  name: string
  target_raw_table: string
}

interface PreviewData {
  layer: string
  table_name: string
  total: number
  page: number
  page_size: number
  columns: string[]
  rows: Record<string, any>[]
}

const LAYER_TABS = [
  { key: 'raw', label: 'RAW（原始层）' },
  { key: 'dwd', label: 'DWD（明细层）' },
  { key: 'dws', label: 'DWS（汇总层）' },
  { key: 'ads', label: 'ADS（应用层）' },
]

export default function DataPreview() {
  const [sources, setSources] = useState<DataSource[]>([])
  const [selectedDs, setSelectedDs] = useState<number | null>(null)
  const [layer, setLayer] = useState<string>('raw')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<PreviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    client.get('/datasources').then((r) => setSources(r.data))
  }, [])

  const load = useCallback(async (dsId: number, lyr: string, pg: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await client.get(
        `/datasources/${dsId}/preview/${lyr}?page=${pg}&page_size=50`
      )
      setData(res.data)
    } catch (err: any) {
      const detail = err?.response?.data?.detail || '加载失败'
      setError(detail)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleDsChange = (dsId: number) => {
    setSelectedDs(dsId)
    setLayer('raw')
    setPage(1)
    setData(null)
    setError(null)
    load(dsId, 'raw', 1)
  }

  const handleLayerChange = (lyr: string) => {
    setLayer(lyr)
    setPage(1)
    setData(null)
    if (selectedDs) load(selectedDs, lyr, 1)
  }

  const handlePageChange = (pg: number) => {
    setPage(pg)
    if (selectedDs) load(selectedDs, layer, pg)
  }

  const tableColumns = data
    ? data.columns.map((col) => ({
        title: col,
        dataIndex: col,
        key: col,
        width: 150,
        ellipsis: true,
        render: (v: any) => (v === null || v === undefined ? '' : String(v)),
      }))
    : []

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>数据预览</Title>

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
          <Card title="2. 选择数据层">
            <Tabs
              activeKey={layer}
              onChange={handleLayerChange}
              items={LAYER_TABS.map((t) => ({ key: t.key, label: t.label }))}
            />

            {data && (
              <Space style={{ marginBottom: 12 }}>
                <Tag color="blue">{data.table_name}</Tag>
                <Text type="secondary">共 {data.total.toLocaleString()} 行</Text>
              </Space>
            )}

            {error && (
              <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />
            )}

            <Table
              rowKey={(_, idx) => String(idx)}
              dataSource={data?.rows || []}
              columns={tableColumns}
              loading={loading}
              size="small"
              scroll={{ x: 'max-content' }}
              pagination={{
                current: page,
                pageSize: 50,
                total: data?.total || 0,
                onChange: handlePageChange,
                showTotal: (total) => `共 ${total} 行`,
                showSizeChanger: false,
              }}
              locale={{ emptyText: error ? '请先执行对应 ETL 步骤' : '暂无数据' }}
            />
          </Card>
        )}
      </Space>
    </div>
  )
}

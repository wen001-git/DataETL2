import { useEffect, useState, useCallback } from 'react'
import {
  Select, Button, Table, Input, InputNumber, Space, Card, Typography,
  message, Alert, Transfer,
} from 'antd'
import {
  SaveOutlined, PlusOutlined, DeleteOutlined,
  PlayCircleOutlined, DownloadOutlined, ReloadOutlined,
} from '@ant-design/icons'
import type { TransferProps } from 'antd'
import client from '../api/client'

const { Title, Text } = Typography
const { Option } = Select

interface DataSource {
  id: number
  name: string
  target_raw_table: string
}

interface OrderRow {
  key: number
  field: string
  direction: 'ASC' | 'DESC'
}

let _nextKey = 1
const nextKey = () => _nextKey++

export default function AdsRules() {
  const [sources, setSources] = useState<DataSource[]>([])
  const [selectedDs, setSelectedDs] = useState<number | null>(null)
  const [dwsCols, setDwsCols] = useState<string[]>([])
  const [srcDwsTable, setSrcDwsTable] = useState('')
  const [targetAdsTable, setTargetAdsTable] = useState('')
  const [selectedFields, setSelectedFields] = useState<string[]>([])
  const [orderRows, setOrderRows] = useState<OrderRow[]>([])
  const [limitRows, setLimitRows] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [colError, setColError] = useState<string | null>(null)

  useEffect(() => {
    client.get('/datasources').then((r) => setSources(r.data))
  }, [])

  const loadForDs = useCallback(async (dsId: number) => {
    setLoading(true)
    setColError(null)
    setDwsCols([])
    setSrcDwsTable('')
    setTargetAdsTable('')
    setSelectedFields([])
    setOrderRows([])
    setLimitRows(null)
    try {
      const [dwsRes, ruleRes] = await Promise.all([
        client.get(`/datasources/${dsId}/dws-columns`),
        client.get(`/datasources/${dsId}/ads-rules`),
      ])
      const cols: string[] = dwsRes.data.columns
      const dwsTable: string = dwsRes.data.dws_table
      setDwsCols(cols)
      setSrcDwsTable(dwsTable)

      const rule = ruleRes.data
      if (rule) {
        setTargetAdsTable(rule.target_ads_table)
        setSelectedFields(rule.selected_fields || [])
        setOrderRows(
          (rule.order_by || []).map((o: any) => ({
            key: nextKey(),
            field: o.field,
            direction: o.direction,
          }))
        )
        setLimitRows(rule.limit_rows || null)
      } else {
        const suggested = dwsTable.startsWith('dws_')
          ? 'ads_' + dwsTable.slice(4)
          : 'ads_' + dwsTable
        setTargetAdsTable(suggested)
      }
    } catch (err: any) {
      setColError(err?.response?.data?.detail || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleDsChange = (dsId: number) => {
    setSelectedDs(dsId)
    loadForDs(dsId)
  }

  const updateOrderRow = (key: number, field: keyof OrderRow, value: any) => {
    setOrderRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, [field]: value } : r))
    )
  }

  const addOrderRow = () => {
    setOrderRows((prev) => [
      ...prev,
      { key: nextKey(), field: dwsCols[0] || '', direction: 'ASC' },
    ])
  }

  const deleteOrderRow = (key: number) => {
    setOrderRows((prev) => prev.filter((r) => r.key !== key))
  }

  const handleSave = async () => {
    if (!selectedDs) return
    setSaving(true)
    try {
      await client.put(`/datasources/${selectedDs}/ads-rules`, {
        src_dws_table: srcDwsTable,
        target_ads_table: targetAdsTable,
        selected_fields: selectedFields,
        order_by: orderRows.map((r) => ({ field: r.field, direction: r.direction })),
        limit_rows: limitRows || null,
      })
      message.success('ADS 输出规则已保存')
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleExecute = async () => {
    if (!selectedDs) return
    setExecuting(true)
    try {
      const res = await client.post(`/datasources/${selectedDs}/execute/dws-to-ads`)
      const { status, rows_written, ads_table, error } = res.data
      if (status === 'success') {
        message.success(`执行成功：写入 ${rows_written} 行到 ${ads_table}`)
      } else {
        message.error(`执行失败：${error}`)
      }
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '执行请求失败')
    } finally {
      setExecuting(false)
    }
  }

  const handleDownload = async (format: 'csv' | 'excel') => {
    if (!selectedDs) return
    try {
      const res = await client.get(`/datasources/${selectedDs}/export?format=${format}`, {
        responseType: 'blob',
      })
      const ext = format === 'excel' ? 'xlsx' : 'csv'
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `${targetAdsTable || 'export'}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      message.error('下载失败，请先执行 DWS→ADS')
    }
  }

  // Transfer data: each column is a transfer item
  const transferData: TransferProps['dataSource'] = dwsCols.map((c) => ({
    key: c,
    title: c,
  }))

  const orderColumns = [
    {
      title: '#',
      width: 40,
      render: (_: any, __: any, idx: number) => (
        <Text type="secondary" style={{ fontSize: 12 }}>{idx + 1}</Text>
      ),
    },
    {
      title: '字段',
      dataIndex: 'field',
      width: 200,
      render: (v: string, row: OrderRow) => (
        <Select
          value={v}
          size="small"
          style={{ width: 188 }}
          onChange={(val) => updateOrderRow(row.key, 'field', val)}
        >
          {dwsCols.map((c) => <Option key={c} value={c}>{c}</Option>)}
        </Select>
      ),
    },
    {
      title: '排序方向',
      dataIndex: 'direction',
      width: 130,
      render: (v: string, row: OrderRow) => (
        <Select
          value={v}
          size="small"
          style={{ width: 118 }}
          onChange={(val) => updateOrderRow(row.key, 'direction', val)}
        >
          <Option value="ASC">ASC 升序</Option>
          <Option value="DESC">DESC 降序</Option>
        </Select>
      ),
    },
    {
      title: '',
      width: 48,
      render: (_: any, row: OrderRow) => (
        <Button
          danger
          size="small"
          icon={<DeleteOutlined />}
          onClick={() => deleteOrderRow(row.key)}
        />
      ),
    },
  ]

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>ADS 输出规则配置</Title>

      <Space direction="vertical" style={{ width: '100%' }} size="large">
        <Card title="1. 选择数据源">
          <Space wrap>
            <Select
              style={{ width: 360 }}
              placeholder="选择数据源"
              value={selectedDs}
              onChange={handleDsChange}
              loading={loading}
            >
              {sources.map((s) => (
                <Option key={s.id} value={s.id}>
                  {s.name}
                  <Text type="secondary"> — {s.target_raw_table}</Text>
                </Option>
              ))}
            </Select>
            {selectedDs && (
              <Button
                icon={<ReloadOutlined />}
                onClick={() => loadForDs(selectedDs)}
                loading={loading}
              >
                刷新
              </Button>
            )}
          </Space>
        </Card>

        {colError && (
          <Alert
            type="warning"
            showIcon
            message={colError}
            description="请先完成 DWS 聚合规则配置并执行 DWD→DWS，才能配置 ADS 输出规则。"
          />
        )}

        {selectedDs && !colError && (
          <>
            <Card title="2. 基本配置">
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Space align="center">
                  <Text strong style={{ width: 120 }}>来源 DWS 表：</Text>
                  <Text code>{srcDwsTable || '—'}</Text>
                </Space>

                <Space align="center">
                  <Text strong style={{ width: 120 }}>目标 ADS 表：</Text>
                  <Input
                    value={targetAdsTable}
                    style={{ width: 280 }}
                    placeholder="如：ads_monthly_report"
                    onChange={(e) => setTargetAdsTable(e.target.value)}
                  />
                </Space>

                <Space align="center">
                  <Text strong style={{ width: 120 }}>最多输出行数：</Text>
                  <InputNumber
                    value={limitRows}
                    min={1}
                    placeholder="不限（留空）"
                    style={{ width: 200 }}
                    onChange={(v) => setLimitRows(v)}
                  />
                  <Text type="secondary">（不填 = 全部输出）</Text>
                </Space>
              </Space>
            </Card>

            <Card
              title="3. 输出字段选择"
              extra={
                <Text type="secondary" style={{ fontSize: 12 }}>
                  左侧 = 全部字段；右侧 = 输出字段（按顺序）；不选则输出全部
                </Text>
              }
            >
              <Transfer
                dataSource={transferData}
                targetKeys={selectedFields}
                onChange={(nextKeys) => setSelectedFields(nextKeys as string[])}
                render={(item) => item.title!}
                listStyle={{ width: 260, height: 240 }}
                titles={['可用字段', '输出字段']}
                showSearch
              />
            </Card>

            <Card
              title={
                <Space>
                  <span>4. 排序规则</span>
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    {orderRows.length === 0 ? '（不排序）' : `${orderRows.length} 个排序条件`}
                  </Text>
                </Space>
              }
            >
              {orderRows.length > 0 && (
                <Table
                  rowKey="key"
                  dataSource={orderRows}
                  columns={orderColumns}
                  pagination={false}
                  size="small"
                  style={{ marginBottom: 16 }}
                />
              )}

              <Space wrap>
                <Button icon={<PlusOutlined />} onClick={addOrderRow} disabled={dwsCols.length === 0}>
                  添加排序条件
                </Button>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  onClick={handleSave}
                  loading={saving}
                >
                  保存配置
                </Button>
                <Button
                  icon={<PlayCircleOutlined />}
                  onClick={handleExecute}
                  loading={executing}
                  style={{ borderColor: '#52c41a', color: '#52c41a' }}
                >
                  执行 DWS→ADS
                </Button>
                <Button
                  icon={<DownloadOutlined />}
                  onClick={() => handleDownload('csv')}
                >
                  导出 CSV
                </Button>
                <Button
                  icon={<DownloadOutlined />}
                  onClick={() => handleDownload('excel')}
                >
                  导出 Excel
                </Button>
              </Space>
            </Card>
          </>
        )}
      </Space>
    </div>
  )
}

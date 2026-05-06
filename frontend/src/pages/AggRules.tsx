import { useEffect, useState, useCallback } from 'react'
import {
  Select, Button, Table, Input, Space, Card, Typography,
  message, Alert,
} from 'antd'
import {
  SaveOutlined, PlusOutlined, DeleteOutlined,
  PlayCircleOutlined, ReloadOutlined,
} from '@ant-design/icons'
import client from '../api/client'

const { Title, Text } = Typography
const { Option } = Select

const AGG_FUNCS = ['SUM', 'COUNT', 'AVG', 'MAX', 'MIN', 'COUNT_DISTINCT']

interface DataSource {
  id: number
  name: string
  target_raw_table: string
}

interface AggRow {
  key: number
  field: string
  func: string
  alias: string
}

let _nextKey = 1
const nextKey = () => _nextKey++

export default function AggRules() {
  const [sources, setSources] = useState<DataSource[]>([])
  const [selectedDs, setSelectedDs] = useState<number | null>(null)
  const [dwdCols, setDwdCols] = useState<string[]>([])
  const [srcDwdTable, setSrcDwdTable] = useState('')
  const [targetDwsTable, setTargetDwsTable] = useState('')
  const [groupByFields, setGroupByFields] = useState<string[]>([])
  const [aggRows, setAggRows] = useState<AggRow[]>([])
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
    setDwdCols([])
    setSrcDwdTable('')
    setTargetDwsTable('')
    setGroupByFields([])
    setAggRows([])
    try {
      const [dwdRes, ruleRes] = await Promise.all([
        client.get(`/datasources/${dsId}/dwd-columns`),
        client.get(`/datasources/${dsId}/agg-rules`),
      ])
      const cols: string[] = dwdRes.data.columns
      const dwd: string = dwdRes.data.dwd_table
      setDwdCols(cols)
      setSrcDwdTable(dwd)

      const rule = ruleRes.data
      if (rule) {
        setTargetDwsTable(rule.target_dws_table)
        setGroupByFields(rule.group_by_fields || [])
        setAggRows(
          (rule.agg_functions || []).map((f: any) => ({
            key: nextKey(),
            field: f.field,
            func: f.func,
            alias: f.alias,
          }))
        )
      } else {
        // Suggest default DWS table name
        const suggested = dwd.startsWith('dwd_')
          ? 'dws_' + dwd.slice(4)
          : 'dws_' + dwd
        setTargetDwsTable(suggested)
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

  const updateRow = (key: number, field: keyof AggRow, value: string) => {
    setAggRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, [field]: value } : r))
    )
  }

  const addRow = () => {
    setAggRows((prev) => [
      ...prev,
      { key: nextKey(), field: dwdCols[0] || '', func: 'SUM', alias: '' },
    ])
  }

  const deleteRow = (key: number) => {
    setAggRows((prev) => prev.filter((r) => r.key !== key))
  }

  const handleSave = async () => {
    if (!selectedDs) return
    setSaving(true)
    try {
      await client.put(`/datasources/${selectedDs}/agg-rules`, {
        src_dwd_table: srcDwdTable,
        target_dws_table: targetDwsTable,
        group_by_fields: groupByFields,
        agg_functions: aggRows.map((r) => ({
          field: r.field,
          func: r.func,
          alias: r.alias,
        })),
      })
      message.success('聚合规则已保存')
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
      const res = await client.post(`/datasources/${selectedDs}/execute/dwd-to-dws`)
      const { status, rows_written, dws_table, error } = res.data
      if (status === 'success') {
        message.success(`执行成功：写入 ${rows_written} 行到 ${dws_table}`)
      } else {
        message.error(`执行失败：${error}`)
      }
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '执行请求失败')
    } finally {
      setExecuting(false)
    }
  }

  const aggColumns = [
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
      width: 180,
      render: (v: string, row: AggRow) => (
        <Select
          value={v}
          size="small"
          style={{ width: 168 }}
          onChange={(val) => updateRow(row.key, 'field', val)}
        >
          {dwdCols.map((c) => <Option key={c} value={c}>{c}</Option>)}
        </Select>
      ),
    },
    {
      title: '聚合函数',
      dataIndex: 'func',
      width: 160,
      render: (v: string, row: AggRow) => (
        <Select
          value={v}
          size="small"
          style={{ width: 148 }}
          onChange={(val) => updateRow(row.key, 'func', val)}
        >
          {AGG_FUNCS.map((f) => <Option key={f} value={f}>{f}</Option>)}
        </Select>
      ),
    },
    {
      title: '结果列名（别名）',
      dataIndex: 'alias',
      render: (v: string, row: AggRow) => (
        <Input
          value={v}
          size="small"
          placeholder="如：total_revenue"
          style={{ width: 200 }}
          onChange={(e) => updateRow(row.key, 'alias', e.target.value)}
        />
      ),
    },
    {
      title: '',
      width: 48,
      render: (_: any, row: AggRow) => (
        <Button
          danger
          size="small"
          icon={<DeleteOutlined />}
          onClick={() => deleteRow(row.key)}
        />
      ),
    },
  ]

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>DWS 聚合规则配置</Title>

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
            description="请先完成字段映射配置并执行 Raw→DWD，才能配置聚合规则。"
          />
        )}

        {selectedDs && !colError && (
          <>
            <Card title="2. 聚合配置">
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Space align="center">
                  <Text strong style={{ width: 120 }}>来源 DWD 表：</Text>
                  <Text code>{srcDwdTable || '—'}</Text>
                </Space>

                <Space align="center">
                  <Text strong style={{ width: 120 }}>目标 DWS 表：</Text>
                  <Input
                    value={targetDwsTable}
                    style={{ width: 280 }}
                    placeholder="如：dws_monthly_summary"
                    onChange={(e) => setTargetDwsTable(e.target.value)}
                  />
                </Space>

                <Space align="start">
                  <Text strong style={{ width: 120, lineHeight: '32px' }}>GROUP BY 字段：</Text>
                  <Select
                    mode="multiple"
                    value={groupByFields}
                    style={{ width: 400 }}
                    placeholder="选择 GROUP BY 的字段（可多选）"
                    onChange={setGroupByFields}
                  >
                    {dwdCols.map((c) => <Option key={c} value={c}>{c}</Option>)}
                  </Select>
                </Space>
              </Space>
            </Card>

            <Card
              title={
                <Space>
                  <span>3. 聚合函数</span>
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    {aggRows.length === 0 ? '（未配置聚合函数）' : `${aggRows.length} 个聚合项`}
                  </Text>
                </Space>
              }
            >
              {aggRows.length > 0 && (
                <Table
                  rowKey="key"
                  dataSource={aggRows}
                  columns={aggColumns}
                  pagination={false}
                  size="small"
                  style={{ marginBottom: 16 }}
                />
              )}

              <Space>
                <Button icon={<PlusOutlined />} onClick={addRow} disabled={dwdCols.length === 0}>
                  添加聚合函数
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
                  执行 DWD→DWS
                </Button>
              </Space>
            </Card>
          </>
        )}
      </Space>
    </div>
  )
}

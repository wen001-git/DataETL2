import { useEffect, useState, useCallback } from 'react'
import {
  Select, Button, Table, Input, Space, Card, Typography,
  message, Alert, Tooltip,
} from 'antd'
import {
  SaveOutlined, PlusOutlined, DeleteOutlined,
  InfoCircleOutlined, ReloadOutlined,
} from '@ant-design/icons'
import client from '../api/client'

const { Title, Text } = Typography
const { Option } = Select

const OPERATORS = [
  { value: 'eq',          label: '等于 (=)' },
  { value: 'ne',          label: '不等于 (≠)' },
  { value: 'gt',          label: '大于 (>)' },
  { value: 'lt',          label: '小于 (<)' },
  { value: 'gte',         label: '大于等于 (≥)' },
  { value: 'lte',         label: '小于等于 (≤)' },
  { value: 'contains',    label: '包含' },
  { value: 'not_contains',label: '不包含' },
  { value: 'is_null',     label: '为空' },
  { value: 'is_not_null', label: '不为空' },
]

const NO_VALUE_OPS = new Set(['is_null', 'is_not_null'])

interface DataSource {
  id: number
  name: string
  target_raw_table: string
}

interface FilterRow {
  key: number
  field_name: string
  operator: string
  value: string
  logic: 'AND' | 'OR'
  sort_order: number
}

let _nextKey = 1
const nextKey = () => _nextKey++

export default function FilterRules() {
  const [sources, setSources] = useState<DataSource[]>([])
  const [selectedDs, setSelectedDs] = useState<number | null>(null)
  const [rawCols, setRawCols] = useState<string[]>([])
  const [rows, setRows] = useState<FilterRow[]>([])
  const [loadingCols, setLoadingCols] = useState(false)
  const [saving, setSaving] = useState(false)
  const [colError, setColError] = useState<string | null>(null)

  useEffect(() => {
    client.get('/datasources').then((r) => setSources(r.data))
  }, [])

  const loadForDs = useCallback(async (dsId: number) => {
    setLoadingCols(true)
    setColError(null)
    setRows([])
    setRawCols([])
    try {
      const [colRes, ruleRes] = await Promise.all([
        client.get(`/datasources/${dsId}/raw-columns`),
        client.get(`/datasources/${dsId}/filter-rules`),
      ])
      setRawCols(colRes.data.columns)
      setRows(
        (ruleRes.data as any[]).map((r) => ({
          key: nextKey(),
          field_name: r.field_name,
          operator: r.operator,
          value: r.value || '',
          logic: r.logic,
          sort_order: r.sort_order,
        }))
      )
    } catch (err: any) {
      setColError(err?.response?.data?.detail || '加载失败')
    } finally {
      setLoadingCols(false)
    }
  }, [])

  const handleDsChange = (dsId: number) => {
    setSelectedDs(dsId)
    loadForDs(dsId)
  }

  const updateRow = (key: number, field: keyof FilterRow, value: any) => {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, [field]: value } : r))
    )
  }

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      { key: nextKey(), field_name: rawCols[0] || '', operator: 'eq', value: '', logic: 'AND', sort_order: prev.length },
    ])
  }

  const deleteRow = (key: number) => {
    setRows((prev) => prev.filter((r) => r.key !== key))
  }

  const handleSave = async () => {
    if (!selectedDs) return
    setSaving(true)
    try {
      await client.put(`/datasources/${selectedDs}/filter-rules`, {
        rules: rows.map((r, i) => ({
          field_name: r.field_name,
          operator: r.operator,
          value: NO_VALUE_OPS.has(r.operator) ? null : r.value || null,
          logic: r.logic,
          sort_order: i,
        })),
      })
      message.success('过滤规则已保存')
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const columns = [
    {
      title: '#',
      width: 40,
      render: (_: any, __: any, idx: number) => (
        <Text type="secondary" style={{ fontSize: 12 }}>{idx + 1}</Text>
      ),
    },
    {
      title: (
        <span>
          逻辑&nbsp;
          <Tooltip title="第一条规则始终作为 WHERE 起点；后续规则选择 AND / OR 与前条组合">
            <InfoCircleOutlined style={{ color: '#999' }} />
          </Tooltip>
        </span>
      ),
      dataIndex: 'logic',
      width: 100,
      render: (v: string, row: FilterRow, idx: number) =>
        idx === 0 ? (
          <Text type="secondary" style={{ fontSize: 12, paddingLeft: 8 }}>WHERE</Text>
        ) : (
          <Select
            value={v}
            size="small"
            style={{ width: 80 }}
            onChange={(val) => updateRow(row.key, 'logic', val)}
          >
            <Option value="AND">AND</Option>
            <Option value="OR">OR</Option>
          </Select>
        ),
    },
    {
      title: '字段',
      dataIndex: 'field_name',
      width: 160,
      render: (v: string, row: FilterRow) => (
        <Select
          value={v}
          size="small"
          style={{ width: 148 }}
          onChange={(val) => updateRow(row.key, 'field_name', val)}
        >
          {rawCols.map((c) => <Option key={c} value={c}>{c}</Option>)}
        </Select>
      ),
    },
    {
      title: '运算符',
      dataIndex: 'operator',
      width: 160,
      render: (v: string, row: FilterRow) => (
        <Select
          value={v}
          size="small"
          style={{ width: 148 }}
          onChange={(val) => {
            updateRow(row.key, 'operator', val)
            if (NO_VALUE_OPS.has(val)) updateRow(row.key, 'value', '')
          }}
        >
          {OPERATORS.map((op) => (
            <Option key={op.value} value={op.value}>{op.label}</Option>
          ))}
        </Select>
      ),
    },
    {
      title: '值',
      dataIndex: 'value',
      render: (v: string, row: FilterRow) => (
        <Input
          value={v}
          size="small"
          placeholder={NO_VALUE_OPS.has(row.operator) ? '—' : '比较值'}
          disabled={NO_VALUE_OPS.has(row.operator)}
          style={{ width: 160 }}
          onChange={(e) => updateRow(row.key, 'value', e.target.value)}
        />
      ),
    },
    {
      title: '',
      width: 48,
      render: (_: any, row: FilterRow) => (
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
      <Title level={4} style={{ marginBottom: 24 }}>过滤规则配置</Title>

      <Space direction="vertical" style={{ width: '100%' }} size="large">
        <Card title="1. 选择数据源">
          <Space wrap>
            <Select
              style={{ width: 360 }}
              placeholder="选择数据源"
              value={selectedDs}
              onChange={handleDsChange}
              loading={loadingCols}
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
                loading={loadingCols}
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
            description="请先在「文件上传」或「SFTP 浏览」页面将数据入库。"
          />
        )}

        {selectedDs && !colError && (
          <Card
            title={
              <Space>
                <span>2. 过滤条件</span>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {rows.length === 0 ? '（无过滤条件，所有行写入 DWD）' : `${rows.length} 条规则`}
                </Text>
              </Space>
            }
          >
            {rows.length > 0 && (
              <Table
                rowKey="key"
                dataSource={rows}
                columns={columns}
                pagination={false}
                size="small"
                style={{ marginBottom: 16 }}
              />
            )}

            <Space>
              <Button icon={<PlusOutlined />} onClick={addRow} disabled={rawCols.length === 0}>
                添加条件
              </Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSave}
                loading={saving}
              >
                保存过滤规则
              </Button>
            </Space>
          </Card>
        )}
      </Space>
    </div>
  )
}

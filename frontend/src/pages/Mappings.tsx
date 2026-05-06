import { useEffect, useState, useCallback } from 'react'
import {
  Select, Button, Table, Input, Checkbox, Space, Card, Typography,
  message, Alert, Tooltip, Upload, Divider, Tag,
} from 'antd'
import {
  SaveOutlined, DownloadOutlined, UploadOutlined,
  InfoCircleOutlined, ReloadOutlined, PlayCircleOutlined,
} from '@ant-design/icons'
import type { UploadFile } from 'antd'
import client from '../api/client'

const { Title, Text } = Typography
const { Option } = Select

const DST_TYPES = ['string', 'integer', 'float', 'date', 'datetime', 'boolean']
const TYPE_COLORS: Record<string, string> = {
  string: 'blue', integer: 'green', float: 'cyan',
  date: 'orange', datetime: 'red', boolean: 'purple',
}

interface DataSource {
  id: number
  name: string
  source_type: string
  target_raw_table: string
}

interface MappingRow {
  src_field: string
  dst_field: string
  dst_type: string
  default_value: string
  skip: boolean
  sort_order: number
}

export default function Mappings() {
  const [sources, setSources] = useState<DataSource[]>([])
  const [selectedDs, setSelectedDs] = useState<number | null>(null)
  const [rawTable, setRawTable] = useState<string>('')
  const [dwdTable, setDwdTable] = useState<string>('')
  const [rows, setRows] = useState<MappingRow[]>([])
  const [loadingCols, setLoadingCols] = useState(false)
  const [saving, setSaving] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [colError, setColError] = useState<string | null>(null)

  // Load all datasources
  useEffect(() => {
    client.get('/datasources').then((r) => setSources(r.data))
  }, [])

  // When datasource changes, load raw columns + existing mappings
  const loadForDs = useCallback(async (dsId: number) => {
    setLoadingCols(true)
    setColError(null)
    setRows([])
    setRawTable('')
    setDwdTable('')

    try {
      // Get raw columns
      const colRes = await client.get(`/datasources/${dsId}/raw-columns`)
      setRawTable(colRes.data.raw_table)

      // Get existing mappings
      const mapRes = await client.get(`/datasources/${dsId}/mappings`)
      const existing: any[] = mapRes.data

      if (existing.length > 0) {
        // Use saved mappings
        setDwdTable(existing[0].target_dwd_table)
        setRows(existing.map((m: any) => ({
          src_field: m.src_field,
          dst_field: m.dst_field,
          dst_type: m.dst_type,
          default_value: m.default_value || '',
          skip: m.skip,
          sort_order: m.sort_order,
        })))
      } else {
        // Auto-populate from raw columns (identity mapping)
        const ds = sources.find((s) => s.id === dsId)
        const suggestedDwd = ds ? `dwd_${ds.target_raw_table.replace(/^raw_/, '')}` : ''
        setDwdTable(suggestedDwd)
        setRows(
          colRes.data.columns.map((col: string, i: number) => ({
            src_field: col,
            dst_field: col,
            dst_type: 'string',
            default_value: '',
            skip: false,
            sort_order: i,
          }))
        )
      }
    } catch (err: any) {
      setColError(err?.response?.data?.detail || '加载失败')
    } finally {
      setLoadingCols(false)
    }
  }, [sources])

  const handleDsChange = (dsId: number) => {
    setSelectedDs(dsId)
    loadForDs(dsId)
  }

  // Update a single cell
  const updateRow = (idx: number, field: keyof MappingRow, value: any) => {
    setRows((prev) => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: value }
      return next
    })
  }

  // Save all mappings
  const handleSave = async () => {
    if (!selectedDs) return
    if (!dwdTable.trim()) { message.warning('请填写 DWD 目标表名'); return }
    setSaving(true)
    try {
      await client.put(`/datasources/${selectedDs}/mappings`, {
        target_dwd_table: dwdTable.trim(),
        mappings: rows.map((r, i) => ({ ...r, sort_order: i })),
      })
      message.success('字段映射已保存')
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  // Execute Raw→DWD
  const handleExecute = async () => {
    if (!selectedDs) return
    setExecuting(true)
    try {
      const res = await client.post(`/datasources/${selectedDs}/execute/raw-to-dwd`)
      const { status, rows_written, dwd_table, error } = res.data
      if (status === 'success') {
        message.success(`执行成功：写入 ${rows_written} 行到 ${dwd_table}`)
      } else {
        message.error(`执行失败：${error}`)
      }
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '执行请求失败')
    } finally {
      setExecuting(false)
    }
  }

  // Download Excel template
  const handleDownloadTemplate = async () => {
    if (!selectedDs) return
    try {
      const res = await client.get(`/datasources/${selectedDs}/mappings/template`, {
        responseType: 'blob',
      })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `mapping_template_${rawTable}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      message.error('下载模板失败')
    }
  }

  // Import from Excel
  const handleImport = async (file: File) => {
    if (!selectedDs) { message.warning('请先选择数据源'); return false }
    if (!dwdTable.trim()) { message.warning('请先填写 DWD 目标表名'); return false }
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await client.post(
        `/datasources/${selectedDs}/mappings/import?target_dwd_table=${encodeURIComponent(dwdTable)}`,
        form
      )
      const imported: any[] = res.data
      setRows(imported.map((m: any) => ({
        src_field: m.src_field,
        dst_field: m.dst_field,
        dst_type: m.dst_type,
        default_value: m.default_value || '',
        skip: m.skip,
        sort_order: m.sort_order,
      })))
      message.success(`已导入 ${imported.length} 条映射规则`)
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '导入失败')
    }
    return false // prevent antd auto-upload
  }

  const activeCount = rows.filter((r) => !r.skip).length

  const columns = [
    {
      title: '#',
      width: 48,
      render: (_: any, __: any, idx: number) => (
        <Text type="secondary" style={{ fontSize: 12 }}>{idx + 1}</Text>
      ),
    },
    {
      title: '源字段（Raw 层）',
      dataIndex: 'src_field',
      width: 180,
      render: (v: string, row: MappingRow) => (
        <Text code style={{ opacity: row.skip ? 0.4 : 1 }}>{v}</Text>
      ),
    },
    {
      title: '目标字段（DWD 层）',
      dataIndex: 'dst_field',
      render: (v: string, _: MappingRow, idx: number) => (
        <Input
          value={v}
          size="small"
          style={{ width: 160 }}
          disabled={rows[idx]?.skip}
          onChange={(e) => updateRow(idx, 'dst_field', e.target.value)}
        />
      ),
    },
    {
      title: '目标类型',
      dataIndex: 'dst_type',
      width: 140,
      render: (v: string, _: MappingRow, idx: number) => (
        <Select
          value={v}
          size="small"
          style={{ width: 120 }}
          disabled={rows[idx]?.skip}
          onChange={(val) => updateRow(idx, 'dst_type', val)}
        >
          {DST_TYPES.map((t) => (
            <Option key={t} value={t}>
              <Tag color={TYPE_COLORS[t]} style={{ margin: 0 }}>{t}</Tag>
            </Option>
          ))}
        </Select>
      ),
    },
    {
      title: (
        <span>
          默认值&nbsp;
          <Tooltip title="当源字段为空时填入此值，留空则保持原值">
            <InfoCircleOutlined style={{ color: '#999' }} />
          </Tooltip>
        </span>
      ),
      dataIndex: 'default_value',
      render: (v: string, _: MappingRow, idx: number) => (
        <Input
          value={v}
          size="small"
          placeholder="可选"
          style={{ width: 120 }}
          disabled={rows[idx]?.skip}
          onChange={(e) => updateRow(idx, 'default_value', e.target.value)}
        />
      ),
    },
    {
      title: (
        <span>
          跳过&nbsp;
          <Tooltip title="勾选后该字段不写入 DWD 层">
            <InfoCircleOutlined style={{ color: '#999' }} />
          </Tooltip>
        </span>
      ),
      dataIndex: 'skip',
      width: 72,
      align: 'center' as const,
      render: (v: boolean, _: MappingRow, idx: number) => (
        <Checkbox
          checked={v}
          onChange={(e) => updateRow(idx, 'skip', e.target.checked)}
        />
      ),
    },
  ]

  const selectedSource = sources.find((s) => s.id === selectedDs)

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>字段映射编辑器</Title>

      <Space direction="vertical" style={{ width: '100%' }} size="large">
        {/* Step 1: select datasource */}
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

          {selectedSource && rawTable && (
            <div style={{ marginTop: 12 }}>
              <Text type="secondary">
                Raw 表：<Tag>{rawTable}</Tag>
              </Text>
            </div>
          )}
        </Card>

        {colError && (
          <Alert
            type="warning"
            showIcon
            message={colError}
            description="请先在「文件上传」或「SFTP 浏览」页面将数据入库，系统才能读取字段列表。"
          />
        )}

        {rows.length > 0 && (
          <>
            {/* Step 2: DWD table name */}
            <Card title="2. DWD 目标表名">
              <Space>
                <Input
                  value={dwdTable}
                  onChange={(e) => setDwdTable(e.target.value)}
                  placeholder="例：dwd_fund_nav"
                  style={{ width: 280 }}
                  addonBefore="etl_dwd."
                />
                <Text type="secondary">（仅字母/数字/下划线）</Text>
              </Space>
            </Card>

            {/* Step 3: mapping table */}
            <Card
              title={
                <Space>
                  <span>3. 字段映射规则</span>
                  <Tag color="blue">{activeCount} 个字段将写入 DWD</Tag>
                  {rows.length - activeCount > 0 && (
                    <Tag color="default">{rows.length - activeCount} 个跳过</Tag>
                  )}
                </Space>
              }
              extra={
                <Space>
                  <Button
                    icon={<DownloadOutlined />}
                    onClick={handleDownloadTemplate}
                    disabled={!selectedDs || rows.length === 0}
                  >
                    下载 Excel 模板
                  </Button>
                  <Upload
                    accept=".xlsx,.xls"
                    showUploadList={false}
                    beforeUpload={handleImport}
                  >
                    <Button icon={<UploadOutlined />} disabled={!selectedDs}>
                      从 Excel 导入
                    </Button>
                  </Upload>
                </Space>
              }
            >
              <Table
                rowKey="src_field"
                dataSource={rows}
                columns={columns}
                pagination={false}
                size="small"
                scroll={{ x: 'max-content' }}
                rowClassName={(row) => row.skip ? 'mapping-row-skipped' : ''}
              />

              <Divider />
              <Space>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  size="large"
                  onClick={handleSave}
                  loading={saving}
                  disabled={!dwdTable.trim()}
                >
                  保存所有映射规则
                </Button>
                <Button
                  icon={<PlayCircleOutlined />}
                  size="large"
                  onClick={handleExecute}
                  loading={executing}
                  disabled={!dwdTable.trim()}
                  style={{ borderColor: '#52c41a', color: '#52c41a' }}
                >
                  执行 Raw→DWD
                </Button>
              </Space>
            </Card>
          </>
        )}
      </Space>

      <style>{`
        .mapping-row-skipped td { opacity: 0.45; }
      `}</style>
    </div>
  )
}

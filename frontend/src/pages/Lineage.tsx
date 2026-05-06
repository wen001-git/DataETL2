import { useCallback, useEffect, useState } from 'react'
import { Select, Card, Typography, Tabs, Table, Button, Space, Tag, Tooltip, Empty, Spin, message } from 'antd'
import { ReactFlow, Node, Edge, Background, Controls, MiniMap, MarkerType } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import client from '../api/client'

const { Title, Text } = Typography
const { Option } = Select

interface DataSource { id: number; name: string }

interface LineageData {
  data_source_id: number
  raw_to_dwd: Array<{ src_field: string; dst_field: string; dst_type: string; skip: boolean; default_value?: string }> | null
  dwd_to_dws: { src_table: string; target_table: string; group_by: string[]; agg_functions: Array<{ field: string; func: string; alias: string }> } | null
  dws_to_ads: { src_table: string; target_table: string; selected_fields: string[]; order_by: Array<{ field: string; direction: string }>; limit_rows?: number } | null
}

interface VersionItem { id: number; saved_at: string; saved_by: number }
interface DiffResult {
  v1: { id: number; saved_at: string }
  v2: { id: number; saved_at: string }
  added: Array<Record<string, unknown>>
  removed: Array<Record<string, unknown>>
  modified: Array<{ src_field: string; changes: Record<string, { from: unknown; to: unknown }> }>
  target_dwd_table_changed: boolean
}

const LAYER_X: Record<string, number> = { raw: 0, dwd: 280, dws: 560, ads: 840 }
const LAYER_COLOR: Record<string, string> = {
  raw: '#e6f4ff',
  dwd: '#f6ffed',
  dws: '#fff7e6',
  ads: '#f9f0ff',
}
const LAYER_BORDER: Record<string, string> = {
  raw: '#91caff',
  dwd: '#95de64',
  dws: '#ffd591',
  ads: '#d3adf7',
}
const TYPE_COLOR: Record<string, string> = {
  string: 'blue', integer: 'green', float: 'orange',
  date: 'purple', datetime: 'magenta', boolean: 'red',
}

function buildNodes(lineage: LineageData): Node[] {
  const nodes: Node[] = []

  // Layer headers
  const layers = [
    { id: 'raw', label: 'RAW 层', subtitle: 'etl_raw' },
    { id: 'dwd', label: 'DWD 层', subtitle: 'etl_dwd' },
    { id: 'dws', label: 'DWS 层', subtitle: 'etl_dws' },
    { id: 'ads', label: 'ADS 层', subtitle: 'etl_ads' },
  ]
  layers.forEach(({ id, label, subtitle }) => {
    nodes.push({
      id: `header-${id}`,
      position: { x: LAYER_X[id], y: 0 },
      data: { label: <div style={{ fontWeight: 700, fontSize: 13 }}>{label}<br /><span style={{ fontWeight: 400, fontSize: 11, color: '#888' }}>{subtitle}</span></div> },
      style: { background: LAYER_COLOR[id], border: `1px solid ${LAYER_BORDER[id]}`, width: 220, textAlign: 'center' },
      draggable: false,
    })
  })

  const Y_START = 70
  const Y_STEP = 52

  // RAW + DWD field nodes (from raw_to_dwd)
  if (lineage.raw_to_dwd) {
    lineage.raw_to_dwd.forEach((m, i) => {
      const y = Y_START + i * Y_STEP
      nodes.push({
        id: `raw-${m.src_field}`,
        position: { x: LAYER_X.raw, y },
        data: { label: <span style={{ fontSize: 12 }}>{m.src_field}</span> },
        style: { background: m.skip ? '#f5f5f5' : LAYER_COLOR.raw, border: `1px solid ${LAYER_BORDER.raw}`, width: 220, opacity: m.skip ? 0.5 : 1 },
        draggable: false,
      })
      if (!m.skip) {
        nodes.push({
          id: `dwd-${m.dst_field}`,
          position: { x: LAYER_X.dwd, y },
          data: {
            label: (
              <span style={{ fontSize: 12 }}>
                {m.dst_field}{' '}
                <Tag color={TYPE_COLOR[m.dst_type] || 'default'} style={{ fontSize: 10, marginLeft: 4 }}>{m.dst_type}</Tag>
              </span>
            ),
          },
          style: { background: LAYER_COLOR.dwd, border: `1px solid ${LAYER_BORDER.dwd}`, width: 220 },
          draggable: false,
        })
      }
    })
  }

  // DWS field nodes (group_by pass-through + agg aliases)
  if (lineage.dwd_to_dws) {
    const dwsFields = [
      ...lineage.dwd_to_dws.group_by,
      ...lineage.dwd_to_dws.agg_functions.map((a) => a.alias),
    ]
    dwsFields.forEach((field, i) => {
      nodes.push({
        id: `dws-${field}`,
        position: { x: LAYER_X.dws, y: Y_START + i * Y_STEP },
        data: { label: <span style={{ fontSize: 12 }}>{field}</span> },
        style: { background: LAYER_COLOR.dws, border: `1px solid ${LAYER_BORDER.dws}`, width: 220 },
        draggable: false,
      })
    })
  }

  // ADS field nodes
  if (lineage.dws_to_ads) {
    const adsFields = lineage.dws_to_ads.selected_fields.length > 0
      ? lineage.dws_to_ads.selected_fields
      : (lineage.dwd_to_dws
          ? [...lineage.dwd_to_dws.group_by, ...lineage.dwd_to_dws.agg_functions.map((a) => a.alias)]
          : [])
    adsFields.forEach((field, i) => {
      nodes.push({
        id: `ads-${field}`,
        position: { x: LAYER_X.ads, y: Y_START + i * Y_STEP },
        data: { label: <span style={{ fontSize: 12 }}>{field}</span> },
        style: { background: LAYER_COLOR.ads, border: `1px solid ${LAYER_BORDER.ads}`, width: 220 },
        draggable: false,
      })
    })
  }

  return nodes
}

function buildEdges(lineage: LineageData): Edge[] {
  const edges: Edge[] = []
  const edgeStyle = { stroke: '#999' }
  const markerEnd = { type: MarkerType.ArrowClosed, color: '#999' }

  // RAW → DWD
  if (lineage.raw_to_dwd) {
    lineage.raw_to_dwd.filter((m) => !m.skip).forEach((m) => {
      edges.push({
        id: `e-raw-dwd-${m.src_field}`,
        source: `raw-${m.src_field}`,
        target: `dwd-${m.dst_field}`,
        style: edgeStyle,
        markerEnd,
        label: m.src_field !== m.dst_field ? '重命名' : undefined,
      })
    })
  }

  // DWD → DWS (group_by fields pass through)
  if (lineage.dwd_to_dws) {
    lineage.dwd_to_dws.group_by.forEach((f) => {
      edges.push({
        id: `e-dwd-dws-gb-${f}`,
        source: `dwd-${f}`,
        target: `dws-${f}`,
        style: edgeStyle,
        markerEnd,
        label: 'GROUP BY',
      })
    })
    lineage.dwd_to_dws.agg_functions.forEach((a) => {
      edges.push({
        id: `e-dwd-dws-agg-${a.alias}`,
        source: `dwd-${a.field}`,
        target: `dws-${a.alias}`,
        style: { stroke: '#fa8c16' },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#fa8c16' },
        label: a.func,
      })
    })
  }

  // DWS → ADS
  if (lineage.dws_to_ads) {
    const adsFields = lineage.dws_to_ads.selected_fields.length > 0
      ? lineage.dws_to_ads.selected_fields
      : (lineage.dwd_to_dws
          ? [...lineage.dwd_to_dws.group_by, ...lineage.dwd_to_dws.agg_functions.map((a) => a.alias)]
          : [])
    adsFields.forEach((f) => {
      edges.push({
        id: `e-dws-ads-${f}`,
        source: `dws-${f}`,
        target: `ads-${f}`,
        style: edgeStyle,
        markerEnd,
      })
    })
  }

  return edges
}

export default function LineagePage() {
  const [sources, setSources] = useState<DataSource[]>([])
  const [selectedDs, setSelectedDs] = useState<number | null>(null)
  const [lineage, setLineage] = useState<LineageData | null>(null)
  const [lineageLoading, setLineageLoading] = useState(false)
  const [history, setHistory] = useState<VersionItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [selectedVersions, setSelectedVersions] = useState<number[]>([])
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('current')

  useEffect(() => {
    client.get('/datasources').then((r) => setSources(r.data))
  }, [])

  const loadDs = useCallback(async (dsId: number) => {
    setSelectedDs(dsId)
    setLineage(null)
    setHistory([])
    setDiff(null)
    setSelectedVersions([])
    setLineageLoading(true)
    setHistoryLoading(true)
    try {
      const [lineRes, histRes] = await Promise.all([
        client.get(`/datasources/${dsId}/lineage/config`),
        client.get(`/datasources/${dsId}/lineage/config/history`),
      ])
      setLineage(lineRes.data)
      setHistory(histRes.data)
    } catch {
      message.error('加载血缘数据失败')
    } finally {
      setLineageLoading(false)
      setHistoryLoading(false)
    }
  }, [])

  const handleDiff = async () => {
    if (selectedVersions.length !== 2) { message.warning('请选择恰好 2 个版本进行对比'); return }
    setDiffLoading(true)
    try {
      const [v1, v2] = selectedVersions.sort((a, b) => a - b)
      const res = await client.get(`/datasources/${selectedDs}/lineage/config/diff?v1=${v1}&v2=${v2}`)
      setDiff(res.data)
    } catch {
      message.error('对比失败')
    } finally {
      setDiffLoading(false)
    }
  }

  const nodes = lineage ? buildNodes(lineage) : []
  const edges = lineage ? buildEdges(lineage) : []
  const flowHeight = lineage
    ? Math.max(
        (lineage.raw_to_dwd?.length ?? 0),
        (lineage.dwd_to_dws?.agg_functions.length ?? 0) + (lineage.dwd_to_dws?.group_by.length ?? 0),
        (lineage.dws_to_ads?.selected_fields.length ?? 0),
      ) * 52 + 120
    : 300

  const historyColumns = [
    { title: '版本 ID', dataIndex: 'id', width: 80 },
    { title: '保存时间', dataIndex: 'saved_at', render: (v: string) => v.replace('T', ' ').slice(0, 19) },
    {
      title: '选择对比',
      render: (_: unknown, row: VersionItem) => (
        <input
          type="checkbox"
          checked={selectedVersions.includes(row.id)}
          onChange={(e) => {
            if (e.target.checked) {
              setSelectedVersions((prev) => [...prev, row.id].slice(-2))
            } else {
              setSelectedVersions((prev) => prev.filter((id) => id !== row.id))
            }
          }}
        />
      ),
      width: 80,
    },
  ]

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>数据血缘</Title>

      <div style={{ marginBottom: 16 }}>
        <Select
          style={{ width: 320 }}
          placeholder="选择数据源"
          value={selectedDs}
          onChange={loadDs}
        >
          {sources.map((s) => <Option key={s.id} value={s.id}>{s.name}</Option>)}
        </Select>
      </div>

      {!selectedDs && <Empty description="请选择数据源" />}

      {selectedDs && (
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
          {
            key: 'current',
            label: '当前血缘',
            children: (
              <Card>
                {lineageLoading && <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>}
                {!lineageLoading && lineage && (
                  <div style={{ height: Math.max(flowHeight, 300) }}>
                    <ReactFlow
                      nodes={nodes}
                      edges={edges}
                      fitView
                      fitViewOptions={{ padding: 0.2 }}
                      nodesDraggable={false}
                      nodesConnectable={false}
                      elementsSelectable={false}
                    >
                      <Background />
                      <Controls />
                      <MiniMap />
                    </ReactFlow>
                  </div>
                )}
                {!lineageLoading && lineage && !lineage.raw_to_dwd && (
                  <Text type="secondary">该数据源尚未配置字段映射，请先在「字段映射」页保存映射规则。</Text>
                )}
              </Card>
            ),
          },
          {
            key: 'history',
            label: '版本历史',
            children: (
              <Card>
                <Space style={{ marginBottom: 12 }}>
                  <Text type="secondary">勾选 2 个版本后点击「对比」</Text>
                  <Button
                    type="primary"
                    size="small"
                    loading={diffLoading}
                    disabled={selectedVersions.length !== 2}
                    onClick={handleDiff}
                  >
                    对比选中版本
                  </Button>
                </Space>
                <Table
                  loading={historyLoading}
                  dataSource={history}
                  rowKey="id"
                  columns={historyColumns}
                  pagination={{ pageSize: 10 }}
                  size="small"
                />

                {diff && (
                  <Card
                    title={`版本对比：v${diff.v1.id} → v${diff.v2.id}`}
                    style={{ marginTop: 16 }}
                    size="small"
                  >
                    {diff.target_dwd_table_changed && (
                      <div style={{ marginBottom: 8 }}>
                        <Tag color="orange">DWD 目标表名已变更</Tag>
                      </div>
                    )}
                    {diff.added.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <Text strong style={{ color: '#52c41a' }}>新增字段：</Text>
                        {diff.added.map((m) => (
                          <Tag key={String(m.src_field)} color="success" style={{ margin: 2 }}>{String(m.src_field)}</Tag>
                        ))}
                      </div>
                    )}
                    {diff.removed.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <Text strong style={{ color: '#ff4d4f' }}>删除字段：</Text>
                        {diff.removed.map((m) => (
                          <Tag key={String(m.src_field)} color="error" style={{ margin: 2 }}>{String(m.src_field)}</Tag>
                        ))}
                      </div>
                    )}
                    {diff.modified.length > 0 && (
                      <div>
                        <Text strong style={{ color: '#faad14' }}>修改字段：</Text>
                        {diff.modified.map((m) => (
                          <Tooltip
                            key={m.src_field}
                            title={Object.entries(m.changes).map(([k, v]) =>
                              `${k}: ${v.from} → ${v.to}`
                            ).join('，')}
                          >
                            <Tag color="warning" style={{ margin: 2, cursor: 'pointer' }}>{m.src_field}</Tag>
                          </Tooltip>
                        ))}
                      </div>
                    )}
                    {diff.added.length === 0 && diff.removed.length === 0 && diff.modified.length === 0 && !diff.target_dwd_table_changed && (
                      <Text type="secondary">两个版本的字段映射完全相同</Text>
                    )}
                  </Card>
                )}
              </Card>
            ),
          },
        ]} />
      )}
    </div>
  )
}

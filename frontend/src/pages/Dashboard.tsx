import { useEffect, useState } from 'react'
import {
  Select, Button, Card, Typography, Space, Row, Col, Drawer,
  Form, Input, Empty, Popconfirm, Statistic, Table, Spin, message, Modal,
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, BarChartOutlined,
} from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import client from '../api/client'

const { Title, Text } = Typography
const { Option } = Select
const { TextArea } = Input

interface Dashboard { id: number; name: string; description?: string; chart_count: number }
interface ChartCfg {
  id: number; data_source_id: number; chart_type: string
  config_json: Record<string, string>; sort_order: number
}
interface DashboardDetail { id: number; name: string; description?: string; charts: ChartCfg[] }
interface DataSource { id: number; name: string }
interface ChartData { chart_type: string; columns: string[]; rows: Record<string, unknown>[] }

const CHART_TYPES = [
  { value: 'line', label: '折线图' },
  { value: 'bar', label: '柱状图' },
  { value: 'kpi', label: 'KPI 数字卡片' },
  { value: 'table', label: '数据表格' },
]
const AGG_FUNCS = ['SUM', 'AVG', 'COUNT', 'MAX', 'MIN']

function buildEChartsOption(chart: ChartCfg, data: ChartData) {
  const cfg = chart.config_json
  const xField = cfg.x_field || ''
  const rows = data.rows

  if (chart.chart_type === 'line' || chart.chart_type === 'bar') {
    return {
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: rows.map((r) => String(r[xField] ?? '')) },
      yAxis: { type: 'value' },
      series: [{ type: chart.chart_type, data: rows.map((r) => r['value'] ?? 0) }],
      grid: { left: 40, right: 20, top: 20, bottom: 40 },
    }
  }
  return {}
}

export default function DashboardPage() {
  const [dashboards, setDashboards] = useState<Dashboard[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<DashboardDetail | null>(null)
  const [chartData, setChartData] = useState<Record<number, ChartData>>({})
  const [loadingCharts, setLoadingCharts] = useState<Record<number, boolean>>({})
  const [sources, setSources] = useState<DataSource[]>([])

  // New/edit dashboard modal
  const [dashModal, setDashModal] = useState(false)
  const [dashForm] = Form.useForm()
  const [dashSaving, setDashSaving] = useState(false)

  // New/edit chart drawer
  const [chartDrawer, setChartDrawer] = useState(false)
  const [editingChart, setEditingChart] = useState<ChartCfg | null>(null)
  const [chartForm] = Form.useForm()
  const [chartSaving, setChartSaving] = useState(false)

  useEffect(() => {
    client.get('/dashboards').then((r) => setDashboards(r.data))
    client.get('/datasources').then((r) => setSources(r.data.filter((d: DataSource & { source_type: string }) => true)))
  }, [])

  const loadDashboard = async (id: number) => {
    setSelectedId(id)
    setDetail(null)
    setChartData({})
    const res = await client.get(`/dashboards/${id}`)
    const d: DashboardDetail = res.data
    setDetail(d)
    d.charts.forEach((c) => fetchChartData(id, c))
  }

  const fetchChartData = async (dashId: number, chart: ChartCfg) => {
    setLoadingCharts((prev) => ({ ...prev, [chart.id]: true }))
    try {
      const res = await client.get(`/dashboards/${dashId}/charts/${chart.id}/data`)
      setChartData((prev) => ({ ...prev, [chart.id]: res.data }))
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } }
      setChartData((prev) => ({
        ...prev,
        [chart.id]: { chart_type: chart.chart_type, columns: [], rows: [], error: e?.response?.data?.detail } as ChartData & { error?: string },
      }))
    } finally {
      setLoadingCharts((prev) => ({ ...prev, [chart.id]: false }))
    }
  }

  const handleCreateDashboard = async () => {
    const vals = await dashForm.validateFields()
    setDashSaving(true)
    try {
      const res = await client.post('/dashboards', vals)
      const newDash = { ...res.data, chart_count: 0 }
      setDashboards((prev) => [newDash, ...prev])
      setDashModal(false)
      dashForm.resetFields()
      message.success('仪表盘已创建')
      loadDashboard(newDash.id)
    } catch {
      message.error('创建失败')
    } finally {
      setDashSaving(false)
    }
  }

  const handleDeleteDashboard = async (id: number) => {
    await client.delete(`/dashboards/${id}`)
    setDashboards((prev) => prev.filter((d) => d.id !== id))
    if (selectedId === id) { setSelectedId(null); setDetail(null) }
    message.success('已删除')
  }

  const openAddChart = () => {
    setEditingChart(null)
    chartForm.resetFields()
    setChartDrawer(true)
  }

  const openEditChart = (c: ChartCfg) => {
    setEditingChart(c)
    chartForm.setFieldsValue({
      data_source_id: c.data_source_id,
      chart_type: c.chart_type,
      title: c.config_json.title,
      x_field: c.config_json.x_field,
      y_field: c.config_json.y_field,
      agg_func: c.config_json.agg_func || 'SUM',
      filter_expr: c.config_json.filter_expr,
    })
    setChartDrawer(true)
  }

  const handleSaveChart = async () => {
    const vals = await chartForm.validateFields()
    const payload = {
      data_source_id: vals.data_source_id,
      chart_type: vals.chart_type,
      sort_order: editingChart?.sort_order ?? (detail?.charts.length ?? 0),
      config_json: {
        title: vals.title,
        x_field: vals.x_field,
        y_field: vals.y_field,
        agg_func: vals.agg_func || 'SUM',
        filter_expr: vals.filter_expr,
      },
    }
    setChartSaving(true)
    try {
      if (editingChart) {
        const res = await client.put(`/dashboards/${selectedId}/charts/${editingChart.id}`, payload)
        setDetail((prev) => prev ? {
          ...prev,
          charts: prev.charts.map((c) => c.id === editingChart.id ? { ...c, ...res.data } : c),
        } : prev)
        fetchChartData(selectedId!, { ...editingChart, ...res.data })
      } else {
        const res = await client.post(`/dashboards/${selectedId}/charts`, payload)
        const newChart = res.data
        setDetail((prev) => prev ? { ...prev, charts: [...prev.charts, newChart] } : prev)
        setDashboards((prev) => prev.map((d) => d.id === selectedId ? { ...d, chart_count: d.chart_count + 1 } : d))
        fetchChartData(selectedId!, newChart)
      }
      setChartDrawer(false)
      message.success(editingChart ? '图表已更新' : '图表已添加')
    } catch {
      message.error('保存失败')
    } finally {
      setChartSaving(false)
    }
  }

  const handleDeleteChart = async (chart: ChartCfg) => {
    await client.delete(`/dashboards/${selectedId}/charts/${chart.id}`)
    setDetail((prev) => prev ? { ...prev, charts: prev.charts.filter((c) => c.id !== chart.id) } : prev)
    setDashboards((prev) => prev.map((d) => d.id === selectedId ? { ...d, chart_count: d.chart_count - 1 } : d))
    setChartData((prev) => { const n = { ...prev }; delete n[chart.id]; return n })
    message.success('已删除')
  }

  const renderChart = (chart: ChartCfg) => {
    const data = chartData[chart.id] as (ChartData & { error?: string }) | undefined
    const loading = loadingCharts[chart.id]
    const cfg = chart.config_json

    const actions = [
      <EditOutlined key="edit" onClick={() => openEditChart(chart)} />,
      <Popconfirm key="del" title="确认删除此图表？" onConfirm={() => handleDeleteChart(chart)}>
        <DeleteOutlined />
      </Popconfirm>,
    ]

    return (
      <Col xs={24} xl={12} key={chart.id}>
        <Card
          title={cfg.title || `${CHART_TYPES.find((t) => t.value === chart.chart_type)?.label}`}
          actions={actions}
          size="small"
          style={{ marginBottom: 16 }}
        >
          {loading && <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>}
          {!loading && data?.error && <Text type="secondary">{data.error}</Text>}
          {!loading && data && !data.error && (
            <>
              {chart.chart_type === 'kpi' && (
                <Statistic
                  value={data.rows[0]?.['value'] as number ?? '-'}
                  precision={2}
                  style={{ textAlign: 'center', padding: '16px 0' }}
                />
              )}
              {(chart.chart_type === 'line' || chart.chart_type === 'bar') && (
                <ReactECharts
                  option={buildEChartsOption(chart, data)}
                  style={{ height: 260 }}
                  notMerge
                />
              )}
              {chart.chart_type === 'table' && (
                <Table
                  size="small"
                  dataSource={data.rows}
                  rowKey={(_, i) => String(i)}
                  columns={data.columns.map((c) => ({ title: c, dataIndex: c, ellipsis: true }))}
                  pagination={{ pageSize: 10, size: 'small' }}
                  scroll={{ x: 'max-content' }}
                />
              )}
            </>
          )}
          {!loading && !data && <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        </Card>
      </Col>
    )
  }

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>仪表盘</Title>

      <Space style={{ marginBottom: 16 }}>
        <Select
          style={{ width: 280 }}
          placeholder="选择仪表盘"
          value={selectedId}
          onChange={loadDashboard}
        >
          {dashboards.map((d) => (
            <Option key={d.id} value={d.id}>
              {d.name}
              <Text type="secondary" style={{ marginLeft: 8 }}>({d.chart_count} 图表)</Text>
            </Option>
          ))}
        </Select>
        <Button icon={<PlusOutlined />} onClick={() => { dashForm.resetFields(); setDashModal(true) }}>
          新建仪表盘
        </Button>
        {selectedId && (
          <Popconfirm title="确认删除此仪表盘？" onConfirm={() => handleDeleteDashboard(selectedId)}>
            <Button danger icon={<DeleteOutlined />}>删除仪表盘</Button>
          </Popconfirm>
        )}
      </Space>

      {detail && (
        <>
          <Row gutter={16}>
            {detail.charts.map(renderChart)}
          </Row>
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            style={{ width: '100%', marginTop: 8 }}
            onClick={openAddChart}
          >
            添加图表
          </Button>
        </>
      )}

      {!selectedId && (
        <Empty
          image={<BarChartOutlined style={{ fontSize: 48, color: '#ccc' }} />}
          description="请选择或新建一个仪表盘"
        />
      )}

      {/* New/edit dashboard modal */}
      <Modal
        title="新建仪表盘"
        open={dashModal}
        onOk={handleCreateDashboard}
        onCancel={() => setDashModal(false)}
        confirmLoading={dashSaving}
        okText="创建"
      >
        <Form form={dashForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="例：月度销售仪表盘" />
          </Form.Item>
          <Form.Item name="description" label="描述（可选）">
            <TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Add/edit chart drawer */}
      <Drawer
        title={editingChart ? '编辑图表' : '添加图表'}
        open={chartDrawer}
        onClose={() => setChartDrawer(false)}
        width={440}
        footer={
          <Space style={{ float: 'right' }}>
            <Button onClick={() => setChartDrawer(false)}>取消</Button>
            <Button type="primary" loading={chartSaving} onClick={handleSaveChart}>保存</Button>
          </Space>
        }
      >
        <Form form={chartForm} layout="vertical">
          <Form.Item name="title" label="图表标题" rules={[{ required: true }]}>
            <Input placeholder="例：月度销售趋势" />
          </Form.Item>
          <Form.Item name="data_source_id" label="数据源" rules={[{ required: true }]}>
            <Select placeholder="选择数据源（需已执行 DWS→ADS）">
              {sources.map((s) => <Option key={s.id} value={s.id}>{s.name}</Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="chart_type" label="图表类型" rules={[{ required: true }]}>
            <Select placeholder="选择图表类型">
              {CHART_TYPES.map((t) => <Option key={t.value} value={t.value}>{t.label}</Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="x_field" label="X 轴字段（折线/柱状图）">
            <Input placeholder="例：trade_date" />
          </Form.Item>
          <Form.Item name="y_field" label="Y 轴字段（折线/柱状/KPI）">
            <Input placeholder="例：total_amount" />
          </Form.Item>
          <Form.Item name="agg_func" label="聚合函数" initialValue="SUM">
            <Select>
              {AGG_FUNCS.map((f) => <Option key={f} value={f}>{f}</Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="filter_expr" label="过滤条件（可选，DuckDB SQL）">
            <Input placeholder='例：trade_date >= "2024-01-01"' />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  )
}

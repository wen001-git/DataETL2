import { useEffect, useState } from 'react'
import {
  Table, Button, Modal, Form, Input, Select, InputNumber,
  Space, Popconfirm, message, Tag, Typography,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import client from '../api/client'

const { Title } = Typography
const { Option } = Select

interface DataSource {
  id: number
  name: string
  description: string | null
  source_type: 'sftp' | 'upload'
  sftp_host: string | null
  sftp_port: number | null
  sftp_user: string | null
  sftp_remote_path: string | null
  sftp_file_pattern: string | null
  target_raw_table: string
  created_at: string
}

export default function DataSources() {
  const [sources, setSources] = useState<DataSource[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<DataSource | null>(null)
  const [sourceType, setSourceType] = useState<'sftp' | 'upload'>('upload')
  const [form] = Form.useForm()

  const fetchSources = async () => {
    setLoading(true)
    try {
      const res = await client.get('/datasources')
      setSources(res.data)
    } catch {
      message.error('加载数据源失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSources() }, [])

  const openCreate = () => {
    setEditing(null)
    setSourceType('upload')
    form.resetFields()
    form.setFieldsValue({ source_type: 'upload', sftp_port: 22, sftp_file_pattern: '*.csv' })
    setModalOpen(true)
  }

  const openEdit = (record: DataSource) => {
    setEditing(record)
    setSourceType(record.source_type)
    form.setFieldsValue({
      name: record.name,
      description: record.description,
      source_type: record.source_type,
      sftp_host: record.sftp_host,
      sftp_port: record.sftp_port ?? 22,
      sftp_user: record.sftp_user,
      sftp_remote_path: record.sftp_remote_path,
      sftp_file_pattern: record.sftp_file_pattern ?? '*.csv',
      target_raw_table: record.target_raw_table,
    })
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (editing) {
        await client.put(`/datasources/${editing.id}`, values)
        message.success('数据源已更新')
      } else {
        await client.post('/datasources', values)
        message.success('数据源已创建')
      }
      setModalOpen(false)
      fetchSources()
    } catch (err: any) {
      if (err?.response?.data?.detail) {
        message.error(err.response.data.detail)
      }
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await client.delete(`/datasources/${id}`)
      message.success('已删除')
      fetchSources()
    } catch {
      message.error('删除失败')
    }
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '名称', dataIndex: 'name' },
    {
      title: '类型',
      dataIndex: 'source_type',
      render: (t: string) => (
        <Tag color={t === 'sftp' ? 'blue' : 'green'}>
          {t === 'sftp' ? 'SFTP' : '文件上传'}
        </Tag>
      ),
    },
    { title: 'Raw表名', dataIndex: 'target_raw_table' },
    {
      title: 'SFTP 主机',
      dataIndex: 'sftp_host',
      render: (v: string | null) => v || '—',
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      render: (_: unknown, record: DataSource) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除该数据源？"
            onConfirm={() => handleDelete(record.id)}
            okText="删除"
            cancelText="取消"
          >
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>数据源管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建数据源</Button>
      </div>

      <Table
        rowKey="id"
        dataSource={sources}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 20 }}
      />

      <Modal
        title={editing ? '编辑数据源' : '新建数据源'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
        width={560}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="数据源名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="例：NewRez月度报告" />
          </Form.Item>

          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="可选" />
          </Form.Item>

          <Form.Item name="source_type" label="接入类型" rules={[{ required: true }]}>
            <Select
              onChange={(v) => { setSourceType(v); form.resetFields(['sftp_host','sftp_port','sftp_user','sftp_password','sftp_remote_path','sftp_file_pattern']) }}
              disabled={!!editing}
            >
              <Option value="upload">文件上传（CSV / Excel）</Option>
              <Option value="sftp">SFTP 拉取</Option>
            </Select>
          </Form.Item>

          <Form.Item name="target_raw_table" label="Raw 层目标表名" rules={[{ required: true, message: '请输入目标表名' }]}>
            <Input placeholder="例：raw_newrez_monthly（仅字母/数字/下划线）" />
          </Form.Item>

          {sourceType === 'sftp' && (
            <>
              <Form.Item name="sftp_host" label="SFTP 主机" rules={[{ required: true, message: '请输入主机地址' }]}>
                <Input placeholder="sftp.example.com" />
              </Form.Item>
              <Form.Item name="sftp_port" label="端口">
                <InputNumber min={1} max={65535} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="sftp_user" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
                <Input />
              </Form.Item>
              <Form.Item name="sftp_password" label={editing ? '密码（留空保持不变）' : '密码'}>
                <Input.Password />
              </Form.Item>
              <Form.Item name="sftp_remote_path" label="远程目录" rules={[{ required: true, message: '请输入远程目录' }]}>
                <Input placeholder="/data/reports" />
              </Form.Item>
              <Form.Item name="sftp_file_pattern" label="文件匹配模式">
                <Input placeholder="*.csv" />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </div>
  )
}

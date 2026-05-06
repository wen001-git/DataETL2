import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout, Menu, Typography, Avatar, Dropdown } from 'antd'
import {
  DatabaseOutlined,
  UploadOutlined,
  HistoryOutlined,
  TableOutlined,
  FilterOutlined,
  BarChartOutlined,
  ExportOutlined,
  EyeOutlined,
  UserOutlined,
  LogoutOutlined,
  DashboardOutlined,
  ApartmentOutlined,
} from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'
import Login from './pages/Login'
import DataSources from './pages/DataSources'
import UploadPage from './pages/Upload'
import SftpBrowser from './pages/SftpBrowser'
import Mappings from './pages/Mappings'
import FilterRules from './pages/FilterRules'
import AggRules from './pages/AggRules'
import AdsRules from './pages/AdsRules'
import History from './pages/History'
import DataPreview from './pages/DataPreview'
import DashboardPage from './pages/Dashboard'
import LineagePage from './pages/Lineage'

const { Header, Sider, Content } = Layout
const { Text } = Typography

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('token')
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const username = localStorage.getItem('username') || 'User'

  const menuItems = [
    { key: '/', icon: <DatabaseOutlined />, label: '数据源管理' },
    { key: '/upload', icon: <UploadOutlined />, label: '文件上传' },
    { key: '/sftp', icon: <UploadOutlined />, label: 'SFTP 浏览' },
    { key: '/mappings', icon: <TableOutlined />, label: '字段映射' },
    { key: '/filter-rules', icon: <FilterOutlined />, label: '过滤规则' },
    { key: '/agg-rules', icon: <BarChartOutlined />, label: 'DWS 聚合规则' },
    { key: '/ads-rules', icon: <ExportOutlined />, label: 'ADS 输出规则' },
    { key: '/history', icon: <HistoryOutlined />, label: '执行历史' },
    { key: '/preview', icon: <EyeOutlined />, label: '数据预览' },
    { key: '/dashboard', icon: <DashboardOutlined />, label: '仪表盘' },
    { key: '/lineage', icon: <ApartmentOutlined />, label: '数据血缘' },
  ]

  const userMenu = {
    items: [
      {
        key: 'logout',
        icon: <LogoutOutlined />,
        label: '退出登录',
        onClick: () => {
          localStorage.clear()
          navigate('/login')
        },
      },
    ],
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={220} theme="dark">
        <div style={{ padding: '16px 24px', color: '#fff', fontWeight: 600, fontSize: 16 }}>
          DataETL2
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', borderBottom: '1px solid #f0f0f0' }}>
          <Dropdown menu={userMenu} placement="bottomRight">
            <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar icon={<UserOutlined />} size="small" />
              <Text>{username}</Text>
            </div>
          </Dropdown>
        </Header>
        <Content style={{ margin: 24, background: '#fff', padding: 24, borderRadius: 8 }}>
          <Routes>
            <Route path="/" element={<DataSources />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/sftp" element={<SftpBrowser />} />
            <Route path="/mappings" element={<Mappings />} />
            <Route path="/filter-rules" element={<FilterRules />} />
            <Route path="/agg-rules" element={<AggRules />} />
            <Route path="/ads-rules" element={<AdsRules />} />
            <Route path="/history" element={<History />} />
            <Route path="/preview" element={<DataPreview />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/lineage" element={<LineagePage />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}

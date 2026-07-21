import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import EmployeeSelect, { type EmployeeSelectOption } from './EmployeeSelect'

vi.mock('@/components/shared/lark', () => ({
  UserAvatar: ({ name, size }: { name?: string; size?: string }) => (
    <span aria-label={`${name ?? '成员'}头像`} data-size={size ?? 'default'} />
  )
}))

const OPTIONS: EmployeeSelectOption[] = [
  { id: '1', name: '张三', jobTitle: '产品经理' },
  { id: '2', name: '李四', jobTitle: '前端工程师' },
  { id: '3', name: '王五', jobTitle: 'HRBP' }
]

describe('EmployeeSelect', () => {
  it('打开下拉后支持拼音搜索并选择员工', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()

    render(
      <EmployeeSelect
        options={OPTIONS}
        value={null}
        onValueChange={onValueChange}
        placeholder='选择要预约的员工'
      />
    )

    await user.click(screen.getByRole('combobox'))
    const search = screen.getByPlaceholderText(/搜索姓名/)

    await user.type(search, 'zs')
    expect(search).toHaveValue('zs')
    expect(screen.getByRole('option', { name: /张三/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /李四/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: /张三/ }))
    expect(onValueChange).toHaveBeenCalledWith('1')
  })

  it('选中态触发器仅展示头像与姓名，不含职位；头像为 sm', () => {
    render(<EmployeeSelect options={OPTIONS} value='2' onValueChange={vi.fn()} />)

    const trigger = screen.getByRole('combobox')

    expect(trigger).toHaveTextContent('李四')
    expect(trigger).not.toHaveTextContent('前端工程师')
    expect(screen.getByLabelText('李四头像')).toHaveAttribute('data-size', 'sm')
  })

  it('下拉项使用标准头像尺寸', async () => {
    const user = userEvent.setup()

    render(<EmployeeSelect options={OPTIONS} value={null} onValueChange={vi.fn()} />)

    await user.click(screen.getByRole('combobox'))
    const avatars = screen.getAllByLabelText(/头像/)

    expect(avatars.length).toBeGreaterThan(0)

    for (const avatar of avatars) {
      expect(avatar).toHaveAttribute('data-size', 'default')
    }
  })

  it('locked 时不可更换', () => {
    render(
      <EmployeeSelect options={OPTIONS} value='1' onValueChange={vi.fn()} locked lockedHint='仅展示' />
    )

    expect(screen.getByText('张三')).toBeInTheDocument()
    expect(screen.getByText('仅展示')).toBeInTheDocument()
    expect(screen.queryByText('产品经理')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})

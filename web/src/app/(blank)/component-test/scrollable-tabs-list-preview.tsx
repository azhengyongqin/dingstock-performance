'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsTrigger } from '@/components/ui/tabs'
import ScrollableTabsList from '@/components/shared/ScrollableTabsList'

/** 窄容器演示：无滚动条 + 选中 Tab 自动滚入可视区 */
const ScrollableTabsListPreview = () => (
  <Card>
    <CardHeader>
      <CardTitle>ScrollableTabsList</CardTitle>
      <CardDescription>将容器收窄后切换 Tab，观察无滚动条与自动居中滚动</CardDescription>
    </CardHeader>
    <CardContent>
      <div className='w-64 max-w-full rounded-lg border'>
        <Tabs defaultValue='info' className='gap-0'>
          <ScrollableTabsList className='border-x-0 border-t-0'>
            <TabsTrigger value='info' className='shrink-0'>
              基本信息
            </TabsTrigger>
            <TabsTrigger value='self' className='shrink-0'>
              员工自评
            </TabsTrigger>
            <TabsTrigger value='okr' className='shrink-0'>
              OKR
            </TabsTrigger>
            <TabsTrigger value='peer' className='shrink-0'>
              360°评估
            </TabsTrigger>
            <TabsTrigger value='more' className='shrink-0'>
              更多
            </TabsTrigger>
          </ScrollableTabsList>
          <TabsContent value='info' className='p-3 text-sm'>
            基本信息
          </TabsContent>
          <TabsContent value='self' className='p-3 text-sm'>
            员工自评
          </TabsContent>
          <TabsContent value='okr' className='p-3 text-sm'>
            OKR
          </TabsContent>
          <TabsContent value='peer' className='p-3 text-sm'>
            360°评估
          </TabsContent>
          <TabsContent value='more' className='p-3 text-sm'>
            更多
          </TabsContent>
        </Tabs>
      </div>
    </CardContent>
  </Card>
)

export default ScrollableTabsListPreview

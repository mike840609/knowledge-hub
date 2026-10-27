import { expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({services:vi.fn()}));
vi.mock('@/server/composition',()=>({applicationServices:mocks.services}));
import { GET } from '@/app/api/workspaces/[workspaceId]/sources/[sourceId]/tree/route';
const w='0199f500-0000-7000-8000-000000000001',s='0199f500-0000-7000-8000-000000000002';
it('tree route validates IDs and does not load an invalid source',async()=>{
 const read=vi.fn(); mocks.services.mockReturnValue({establishTrustedCaller:async()=>({caller:{}}),queries:{getSource:read}});
 const response=await GET(new Request('http://localhost/'),{params:Promise.resolve({workspaceId:w,sourceId:'invalid'})});
 expect(response.status).toBe(400); expect(read).not.toHaveBeenCalled();
});
it('unexpected read failures are no-store errors, not successful empty trees',async()=>{
 mocks.services.mockReturnValue({establishTrustedCaller:async()=>({caller:{}}),queries:{getSource:async()=>{throw new Error('offline');}}});
 const response=await GET(new Request('http://localhost/'),{params:Promise.resolve({workspaceId:w,sourceId:s})});
 expect(response.status).toBe(500);expect(response.headers.get('cache-control')).toContain('no-store');
});

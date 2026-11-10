import { isPaymentWorkspaceEnabled, workspacePolicyWriteSchema } from '@/libs/customerPayments/workspacePolicy';

export const dynamic = 'force-dynamic';

async function handle(request: Request, write: boolean) {
  if (!isPaymentWorkspaceEnabled()) {
    return new Response(null, { status: 404 });
  }
  const { workspaceError, workspaceHeaders, workspaceOriginAllowed } = await import('@/libs/customerPayments/server/workspaceHttp');
  if (write && !workspaceOriginAllowed(request)) {
    return Response.json({ error: { code: 'ORIGIN_FORBIDDEN' } }, { status: 403, headers: workspaceHeaders });
  }
  try {
    const slug = new URL(request.url).searchParams.get('salonSlug');
    if (!slug || slug.length > 200) {
      return Response.json({ error: { code: 'SALON_SLUG_REQUIRED' } }, { status: 400, headers: workspaceHeaders });
    }
    const [{ requireRealSalonOwner }, { getSalonBySlug }, { db }, { createWorkspacePolicyRepository }, { workspaceRuntime }] = await Promise.all([
      import('@/libs/adminAuth'),
      import('@/libs/queries'),
      import('@/libs/DB'),
      import('@/libs/customerPayments/server/workspacePolicyRepository'),
      import('@/libs/customerPayments/server/workspaceRuntime'),
    ]);
    const salon = await getSalonBySlug(slug);
    if (!salon) {
      return new Response(null, { status: 404, headers: workspaceHeaders });
    }
    const access = await requireRealSalonOwner(salon.id);
    if (!access.ok) {
      return access.response;
    }
    const runtime = workspaceRuntime();
    const repository = createWorkspacePolicyRepository(db);
    if (!write) {
      return Response.json({ ...await repository.read(salon.id), setupAvailable: runtime.executionEnabled }, { headers: workspaceHeaders });
    }
    const { readCustomerJson } = await import('@/libs/customerAssistant/http.server');
    const input = workspacePolicyWriteSchema.parse(await readCustomerJson(request));
    return Response.json(await repository.write(salon.id, access.admin.id, input, runtime), { headers: workspaceHeaders });
  } catch (error) {
    return workspaceError(error);
  }
}

export async function GET(request: Request) {
  return handle(request, false);
}

export async function PATCH(request: Request) {
  return handle(request, true);
}

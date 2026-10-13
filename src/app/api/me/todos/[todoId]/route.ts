import { createPersonalTodoItemHandlers } from '@/lib/server/personal-todo-api';

type Context = { params: Promise<{ todoId: string }> };
const handlers = createPersonalTodoItemHandlers();

export async function PATCH(request: Request, context: Context) {
  const { todoId } = await context.params;
  return handlers.PATCH(request, todoId);
}

export async function DELETE(request: Request, context: Context) {
  const { todoId } = await context.params;
  return handlers.DELETE(request, todoId);
}

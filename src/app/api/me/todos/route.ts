import { createPersonalTodoCollectionHandlers } from '@/lib/server/personal-todo-api';

const handlers = createPersonalTodoCollectionHandlers();

export const GET = handlers.GET;
export const POST = handlers.POST;

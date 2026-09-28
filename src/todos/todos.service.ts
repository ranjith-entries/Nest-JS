
import { Injectable, NotFoundException } from '@nestjs/common';

export interface Todo {
  id: number;
  title: string;
  done: boolean;
}

@Injectable()
export class TodosService {
  private todos: Todo[] = [
    { id: 1, title: 'Learn NestJS', done: false },
    { id: 2, title: 'Learn Next.js', done: true },
  ];

  findAll(): Todo[] {
    return this.todos;
  }

  private nextId = 3;

  create(title: string): Todo {
    const todo: Todo = { id: this.nextId++, title, done: false };
    this.todos.push(todo);
    return todo;
  }
  
  update(id: number, done: boolean): Todo {
    const todo = this.todos.find((t) => t.id === id);
    if (!todo) {
      throw new NotFoundException(`Todo ${id} not found`);
    }
    todo.done = done;
    return todo;
  }

  remove(id: number): void {
    const index = this.todos.findIndex((t) => t.id === id);
    if (index === -1) {
      throw new NotFoundException(`Todo ${id} not found`);
    }
    this.todos.splice(index, 1);
  }
}

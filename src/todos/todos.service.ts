import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';


@Injectable()
export class TodosService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.todo.findMany({ orderBy: { id: 'asc' } });
  }

  create(title: string) {
    return this.prisma.todo.create({ data: { title } });
  }

  async update(id: number, done: boolean) {
    await this.findOneOrFail(id);
    return this.prisma.todo.update({ where: { id }, data: { done } });
  }

  async remove(id: number): Promise<void> {
    await this.findOneOrFail(id);
    await this.prisma.todo.delete({ where: { id } });
  }

  private async findOneOrFail(id: number) {
    const todo = await this.prisma.todo.findUnique({ where: { id } });
    if (!todo) {
      throw new NotFoundException(`Todo ${id} not found`);
    }
    return todo;
  }
}
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class TodosService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(userId: number) {
    return this.prisma.todo.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
    });
  }

  findAllForAdmin() {
    return this.prisma.todo.findMany({
      orderBy: { id: 'asc' },
      include: { user: { select: { id: true, username: true } } },
    });
  }

  create(userId: number, title: string) {
    return this.prisma.todo.create({ data: { title, userId } });
  }

  async update(userId: number, id: number, done: boolean) {
    await this.findOneOrFail(userId, id);
    return this.prisma.todo.update({ where: { id }, data: { done } });
  }

  async remove(userId: number, id: number): Promise<void> {
    await this.findOneOrFail(userId, id);
    await this.prisma.todo.delete({ where: { id } });
  }

  private async findOneOrFail(userId: number, id: number) {
    const todo = await this.prisma.todo.findFirst({ where: { id, userId } });
    if (!todo) {
      throw new NotFoundException(`Todo ${id} not found`);
    }
    return todo;
  }
}
import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { JwtPayload } from '../auth/jwt-payload.js';
import { CreateTodoDto } from './dto/create-todo.dto.js';
import { UpdateTodoDto } from './dto/update-todo.dto.js';
import { TodosService } from './todos.service.js';

@Controller('todos')
export class TodosController {
  constructor(private readonly todosService: TodosService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.todosService.findAll(user.sub);
  }

  @Get('all')
  @Roles('ADMIN')
  findAllForAdmin() {
    return this.todosService.findAllForAdmin();
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() createTodoDto: CreateTodoDto) {
    return this.todosService.create(user.sub, createTodoDto.title);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() updateTodoDto: UpdateTodoDto,
  ) {
    return this.todosService.update(user.sub, id, updateTodoDto.done);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.todosService.remove(user.sub, id);
  }
}
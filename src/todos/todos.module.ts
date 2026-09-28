import { Module } from '@nestjs/common';
import { TodosService } from './todos.service.js';
import { TodosController } from './todos.controller.js';

@Module({
  providers: [TodosService],
  controllers: [TodosController]
})
export class TodosModule {}

import type { Routes } from '@angular/router';
import { Shell } from './layout/shell/shell';

export const routes: Routes = [
  {
    path: '',
    component: Shell,
    children: [
      { path: '', redirectTo: 'canvas', pathMatch: 'full' },
      {
        path: 'board',
        loadComponent: () => import('./features/board/board').then((m) => m.Board),
      },
      {
        path: 'canvas',
        loadComponent: () => import('./features/canvas/canvas').then((m) => m.Canvas),
      },
      { path: '**', redirectTo: 'canvas' },
    ],
  },
];

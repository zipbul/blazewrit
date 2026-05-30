import type { Routes } from '@angular/router';
import { Shell } from './layout/shell/shell';

export const routes: Routes = [
  {
    path: '',
    component: Shell,
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'board',
        loadComponent: () => import('./features/board/board').then((m) => m.Board),
      },
      {
        path: 'canvas',
        loadComponent: () => import('./features/canvas/canvas').then((m) => m.Canvas),
      },
      {
        path: 'decisions',
        loadComponent: () => import('./features/decisions/decisions').then((m) => m.Decisions),
      },
      {
        path: 'connections',
        loadComponent: () => import('./features/connections/connections').then((m) => m.Connections),
      },
      { path: '**', redirectTo: 'dashboard' },
    ],
  },
];

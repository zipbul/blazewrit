import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SlicePipe } from '@angular/common';
import { WorkspaceStore } from '../../data-access/workspace-store';

@Component({
  selector: 'app-connections',
  imports: [SlicePipe],
  templateUrl: './connections.html',
  styleUrl: './connections.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Connections {
  private readonly store = inject(WorkspaceStore);

  protected readonly connections = this.store.connections;
}

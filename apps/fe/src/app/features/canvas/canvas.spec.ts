import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Canvas } from './canvas';

describe('Canvas', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
      imports: [Canvas],
    }).compileComponents();
  });

  it('creates', () => {
    const fixture = TestBed.createComponent(Canvas);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders project, task and live nodes connected by wires', () => {
    const fixture = TestBed.createComponent(Canvas);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.node.proj')).toBeTruthy();
    expect(el.querySelectorAll('.node.task').length).toBeGreaterThan(0);
    expect(el.querySelector('svg.wires')).toBeTruthy();
  });
});

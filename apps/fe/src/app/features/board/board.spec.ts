import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Board } from './board';

describe('Board', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
      imports: [Board],
    }).compileComponents();
  });

  it('creates', () => {
    const fixture = TestBed.createComponent(Board);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders flow-stage lanes with task cards', () => {
    const fixture = TestBed.createComponent(Board);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.lane').length).toBeGreaterThan(0);
    expect(el.querySelector('.lane.active .tc')).toBeTruthy();
  });
});

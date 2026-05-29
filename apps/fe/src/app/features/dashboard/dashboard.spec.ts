import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Dashboard } from './dashboard';

describe('Dashboard', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
      imports: [Dashboard],
    }).compileComponents();
  });

  it('creates', () => {
    const fixture = TestBed.createComponent(Dashboard);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders bento cards including the flow metro and live panel', () => {
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.bento .card').length).toBeGreaterThan(0);
    expect(el.querySelector('.metro')).toBeTruthy();
    expect(el.querySelector('.live .lv')).toBeTruthy();
  });
});

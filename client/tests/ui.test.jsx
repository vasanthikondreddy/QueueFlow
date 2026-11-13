import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog, EmptyState, StatusBadge } from '../src/components/ui.jsx';

describe('UI components', () => {
  test('StatusBadge shows the status text', () => {
    render(<StatusBadge status="WAITING" />);
    expect(screen.getByText('WAITING')).toBeInTheDocument();
  });

  test('EmptyState renders title, hint and action', () => {
    render(<EmptyState title="Nobody is waiting" hint="Add a person" action={<button>Add</button>} />);
    expect(screen.getByText('Nobody is waiting')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  test('ConfirmDialog calls onConfirm and onCancel', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog danger title="Cancel this token?" message="Sure?" confirmLabel="Cancel token" onConfirm={onConfirm} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel token' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('ConfirmDialog closes on Escape', async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog title="t" message="m" onConfirm={() => {}} onCancel={onCancel} />);
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });
});

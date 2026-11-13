import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const login = vi.fn();
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => ({ login, register: vi.fn() }) }));

import Login from '../src/pages/Login.jsx';
import { validateRegistration } from '../src/pages/Register.jsx';

describe('Login page', () => {
  test('requires email and password before calling the API', async () => {
    render(<MemoryRouter><Login /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/enter your email and password/i);
    expect(login).not.toHaveBeenCalled();
  });

  test('submits credentials', async () => {
    login.mockResolvedValueOnce();
    render(<MemoryRouter><Login /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.com');
    await userEvent.type(screen.getByLabelText('Password'), 'Passw0rdOK');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));
    expect(login).toHaveBeenCalledWith('a@b.com', 'Passw0rdOK');
  });

  test('shows the server error message', async () => {
    login.mockRejectedValueOnce({ response: { data: { error: { message: 'Invalid email or password.' } } } });
    render(<MemoryRouter><Login /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
  });
});

describe('registration validation', () => {
  test('flags short names, bad emails and weak passwords', () => {
    expect(validateRegistration({ name: 'A', email: 'a@b.com', password: 'Passw0rdOK' })).toMatch(/name/i);
    expect(validateRegistration({ name: 'Ann', email: 'nope', password: 'Passw0rdOK' })).toMatch(/email/i);
    expect(validateRegistration({ name: 'Ann', email: 'a@b.com', password: 'short1' })).toMatch(/8 characters/);
    expect(validateRegistration({ name: 'Ann', email: 'a@b.com', password: 'onlyletters' })).toMatch(/number/);
    expect(validateRegistration({ name: 'Ann', email: 'a@b.com', password: 'Passw0rdOK' })).toBe('');
  });
});

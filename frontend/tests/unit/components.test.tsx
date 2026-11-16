import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog, EmptyState, StatusBadge } from '@/components/common';
import { LifecycleStepper } from '@/components/assessment/Lifecycle';
import { MappingChips } from '@/pages/checklists/ChecklistEditorPage';
import { ASSESSMENT_STATUS } from '@/constants/status';

describe('StatusBadge', () => {
  it('renders the human label for a workflow status', () => {
    render(<StatusBadge map={ASSESSMENT_STATUS} value="PENDING_APPROVAL" />);
    expect(screen.getByText('Pending approval')).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('shows title and description', () => {
    render(<EmptyState title="No findings" description="Nothing yet" />);
    expect(screen.getByText('No findings')).toBeInTheDocument();
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
  });
});

describe('ConfirmDialog', () => {
  it('requires a reason before confirming a controlled action', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open onOpenChange={() => undefined} title="Reopen assessment" reasonLabel="Reason" reasonMin={10} onConfirm={onConfirm} confirmLabel="Reopen" />);
    const btn = screen.getByRole('button', { name: 'Reopen' });
    expect(btn).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Reason/), 'Incorrect answer on Q1');
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('Incorrect answer on Q1'));
  });

  it('shows the API error instead of closing when the action fails', async () => {
    render(<ConfirmDialog open onOpenChange={() => undefined} title="Approve" onConfirm={() => Promise.reject(new Error('Assessment is not awaiting approval'))} confirmLabel="Approve" />);
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Assessment is not awaiting approval')).toBeInTheDocument();
  });
});

describe('LifecycleStepper', () => {
  it('hides the approval stage when not configured and marks the current step', () => {
    render(<LifecycleStepper status="UNDER_REVIEW" approvalRequired={false} />);
    expect(screen.queryByText('Pending approval')).not.toBeInTheDocument();
    expect(screen.getByText('Under review').previousSibling).toHaveAttribute('aria-current', 'step');
  });
  it('shows the clarification stage only when it applies', () => {
    const { rerender } = render(<LifecycleStepper status="IN_PROGRESS" approvalRequired />);
    expect(screen.queryByText('Clarification required')).not.toBeInTheDocument();
    rerender(<LifecycleStepper status="CLARIFICATION_REQUIRED" approvalRequired />);
    expect(screen.getByText('Clarification required')).toBeInTheDocument();
  });
});

describe('MappingChips', () => {
  it('labels clauses and Annex A controls and flags mappings needing review', () => {
    render(
      <MappingChips
        mappings={[
          { id: '1', type: 'ANNEX_A', reference: '8.13', title: null, needsReview: true },
          { id: '2', type: 'ISO_CLAUSE', reference: '9.1', title: null, needsReview: false },
        ]}
      />,
    );
    expect(screen.getByText(/8\.13/).closest('span')).toHaveAttribute('title', 'Imported mapping flagged for review');
    expect(screen.getByText(/9\.1/)).toBeInTheDocument();
  });
});

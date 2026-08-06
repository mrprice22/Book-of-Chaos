import { render, screen, waitFor } from '@testing-library/react';
import { KnowledgeMap } from './KnowledgeMap';

// Mermaid's real renderer needs layout measurement that jsdom does not provide, so
// the seam is the library. What matters here is the contract: the source we built
// goes in, its SVG comes out, and a failure is visible rather than blank.
const mermaidMock = vi.hoisted(() => ({
  render: vi.fn<(id: string, source: string) => Promise<{ svg: string }>>(),
  initialize: vi.fn(),
}));

vi.mock('mermaid', () => ({ default: mermaidMock }));

describe('KnowledgeMap', () => {
  beforeEach(() => {
    mermaidMock.render.mockReset();
    mermaidMock.render.mockResolvedValue({ svg: '<svg data-testid="map"></svg>' });
  });

  it('renders the SVG Mermaid produced from the source', async () => {
    render(<KnowledgeMap source="flowchart TD" />);
    await waitFor(() => expect(screen.getByTestId('map')).toBeInTheDocument());
    expect(mermaidMock.render).toHaveBeenCalledWith(expect.any(String), 'flowchart TD');
  });

  it('re-renders on new source without reconfiguring mermaid', async () => {
    const { rerender } = render(<KnowledgeMap source="flowchart TD" />);
    await waitFor(() => expect(screen.getByTestId('map')).toBeInTheDocument());

    // Mermaid's config is module-global, so "how many times ever" is not a thing a
    // single test can assert — but it must not grow with renders.
    const configuredSoFar = mermaidMock.initialize.mock.calls.length;
    rerender(<KnowledgeMap source={'flowchart TD\n  c1["x"]'} />);
    await waitFor(() => expect(mermaidMock.render).toHaveBeenCalledTimes(2));
    expect(mermaidMock.initialize.mock.calls.length).toBe(configuredSoFar);
  });

  it('says the map could not be drawn instead of leaving a blank space', async () => {
    mermaidMock.render.mockRejectedValue(new Error('parse error'));
    render(<KnowledgeMap source="not a flowchart" />);
    await waitFor(() =>
      expect(screen.getByText(/could not be drawn/i)).toBeInTheDocument(),
    );
  });

  it('does not let a slow earlier render overwrite a newer one', async () => {
    let resolveFirst: ((value: { svg: string }) => void) | undefined;
    mermaidMock.render
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue({ svg: '<svg data-testid="second"></svg>' });

    const { rerender } = render(<KnowledgeMap source="first" />);
    rerender(<KnowledgeMap source="second" />);
    await waitFor(() => expect(screen.getByTestId('second')).toBeInTheDocument());

    resolveFirst?.({ svg: '<svg data-testid="first"></svg>' });
    await waitFor(() => expect(screen.getByTestId('second')).toBeInTheDocument());
    expect(screen.queryByTestId('first')).not.toBeInTheDocument();
  });
});

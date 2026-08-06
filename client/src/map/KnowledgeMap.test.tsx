import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('clicking a node', () => {
  // Mermaid renders `click c1 "/chapter/1"` as an anchor; this is that anchor.
  const svgWithLink =
    '<svg><a href="/chapter/7"><text data-testid="node">Seven</text></a></svg>';

  beforeEach(() => {
    window.history.pushState({}, '', '/');
    mermaidMock.render.mockReset();
    mermaidMock.render.mockResolvedValue({ svg: svgWithLink });
  });

  it('navigates in-app instead of reloading the page', async () => {
    render(<KnowledgeMap source="flowchart TD" />);
    await waitFor(() => expect(screen.getByTestId('node')).toBeInTheDocument());

    await userEvent.click(screen.getByTestId('node'));
    expect(window.location.pathname).toBe('/chapter/7');
  });

  it('leaves a modified click to the browser, so open-in-new-tab still works', async () => {
    render(<KnowledgeMap source="flowchart TD" />);
    await waitFor(() => expect(screen.getByTestId('node')).toBeInTheDocument());

    // fireEvent, not userEvent: the modifier has to be on the click event itself,
    // which is what the handler inspects.
    fireEvent.click(screen.getByTestId('node'), { metaKey: true });
    expect(window.location.pathname).toBe('/');
  });

  it('ignores a click that is not on a node link', async () => {
    mermaidMock.render.mockResolvedValue({
      svg: '<svg><text data-testid="node">x</text></svg>',
    });
    render(<KnowledgeMap source="flowchart TD" />);
    await waitFor(() => expect(screen.getByTestId('node')).toBeInTheDocument());

    await userEvent.click(screen.getByTestId('node'));
    expect(window.location.pathname).toBe('/');
  });

  it('leaves an external link alone', async () => {
    mermaidMock.render.mockResolvedValue({
      svg: '<svg><a href="https://example.com/chapter/7"><text data-testid="node">x</text></a></svg>',
    });
    render(<KnowledgeMap source="flowchart TD" />);
    await waitFor(() => expect(screen.getByTestId('node')).toBeInTheDocument());

    await userEvent.click(screen.getByTestId('node'));
    expect(window.location.pathname).toBe('/');
  });
});

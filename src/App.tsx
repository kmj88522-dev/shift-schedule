import { ChangeEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";

type SquareBook = {
  id: string;
  code: string;
  title: string;
  pageIds: string[];
  counters: {
    nextPageNumber: number;
    nextBlockNumber: number;
  };
  createdAt: string;
  updatedAt: string;
};

type SquarePage = {
  id: string;
  code: string;
  bookId: string;
  parentPageId?: string;
  title: string;
  blockIds: string[];
  backgroundColor: string;
  gridEnabled: boolean;
  gridSize: number;
  createdAt: string;
  updatedAt: string;
};

type TextAlign = "left" | "center" | "right";
type FontWeight = "normal" | "bold";
type EditMode = "design" | "content" | "function";

type SquareBlockStyle = {
  backgroundColor: string;
  fillEnabled: boolean;
  textColor: string;
  fontSize: number;
  fontWeight: FontWeight;
  textAlign: TextAlign;
  textOffsetX: number;
  textOffsetY: number;
  borderRadius: number;
  shadow: boolean;
};

type SquareBlock = {
  id: string;
  code: string;
  bookId: string;
  pageId: string;
  parentBlockId?: string;
  type: "text" | "button" | "container";
  role: "content" | "control" | "module";
  x: number;
  y: number;
  width: number;
  height: number;
  content: {
    text?: string;
  };
  value?: string | number | boolean | null;
  style: SquareBlockStyle;
  visible: boolean;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
};

type SquareData = {
  bookIds: string[];
  books: Record<string, SquareBook>;
  pages: Record<string, SquarePage>;
  blocks: Record<string, SquareBlock>;
  counters: {
    nextBookNumber: number;
    nextPageNumber: number;
    nextBlockNumber: number;
  };
};

type MinimalSquareState = {
  app: "Square";
  version: "0.1";
  book: SquareBook;
  pages: Record<string, SquarePage>;
  blocks: Record<string, SquareBlock>;
  currentPageId: string;
  selectedBlockId?: string;
};

type DragState =
  | {
      mode: "move";
      blockId: string;
      startX: number;
      startY: number;
      originalX: number;
      originalY: number;
    }
  | {
      mode: "resize";
      blockId: string;
      startX: number;
      startY: number;
      originalWidth: number;
      originalHeight: number;
    }
  | {
      mode: "text";
      blockId: string;
      startX: number;
      startY: number;
      originalTextOffsetX: number;
      originalTextOffsetY: number;
    };

type AlignmentGuide = {
  x?: number;
  y?: number;
};

const STORAGE_KEY = "square-v0.1-data";
const FALLBACK_STORAGE_KEY = "square:v0.1:state";
const MIN_BLOCK_WIDTH = 96;
const MIN_BLOCK_HEIGHT = 60;
const GRID_SIZE = 12;
const GUIDE_THRESHOLD = 6;
const ASSET_BASE_URL = import.meta.env.BASE_URL;
const ICONS = {
  logo: `${ASSET_BASE_URL}icons/square-logo.png`,
  book: `${ASSET_BASE_URL}icons/square-book.png`,
  page: `${ASSET_BASE_URL}icons/square-page.png`,
  subpage: `${ASSET_BASE_URL}icons/square-subpage.png`,
  block: `${ASSET_BASE_URL}icons/square-block.png`,
};
const PASTEL_SWATCHES = [
  "#ffffff",
  "#fff7d6",
  "#ffe8cc",
  "#fce8e6",
  "#ffdce5",
  "#f4e7ff",
  "#e8def8",
  "#d7e3ff",
  "#dff3ff",
  "#d6f5f5",
  "#e6f4ea",
  "#edf7d2",
  "#f7efd8",
  "#eee7dc",
  "#e9ecef",
  "#dfe5e1",
];

function now() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatCode(prefix: string, value: number) {
  return `${prefix}${String(value).padStart(3, "0")}`;
}

function SquareIcon({ src, size = 18 }: { src: string; size?: number }) {
  return (
    <span className="square-icon-frame" style={{ width: size, height: size }} aria-hidden="true">
      <img className="square-icon" src={src} width={size} height={size} alt="" onError={(event) => event.currentTarget.classList.add("failed")} />
    </span>
  );
}

function defaultBlockStyle(): SquareBlockStyle {
  return {
    backgroundColor: "#ffffff",
    fillEnabled: true,
    textColor: "#202124",
    fontSize: 16,
    fontWeight: "normal",
    textAlign: "left",
    textOffsetX: 0,
    textOffsetY: 0,
    borderRadius: 0,
    shadow: false,
  };
}

function normalizeBlockStyle(style: Partial<SquareBlockStyle> | undefined): SquareBlockStyle {
  const normalized = { ...defaultBlockStyle(), ...style };
  if (normalized.backgroundColor === "transparent") {
    normalized.backgroundColor = "#ffffff";
    normalized.fillEnabled = false;
  }
  return normalized;
}

function snap(value: number, gridSize = GRID_SIZE) {
  return Math.max(0, Math.round(value / gridSize) * gridSize);
}

function snapAtLeast(value: number, minimum: number, gridSize = GRID_SIZE) {
  return Math.max(minimum, Math.round(value / gridSize) * gridSize);
}

function createBookWithPage(bookNumber: number, pageNumber: number) {
  const createdAt = now();
  const bookId = createId("book");
  const pageId = createId("page");

  return {
    bookId,
    pageId,
    book: {
      id: bookId,
      code: formatCode("BK", bookNumber),
      title: `Book ${bookNumber}`,
      pageIds: [pageId],
      counters: {
        nextPageNumber: pageNumber + 1,
        nextBlockNumber: 1,
      },
      createdAt,
      updatedAt: createdAt,
    } satisfies SquareBook,
    page: {
      id: pageId,
      code: formatCode("P", pageNumber),
      bookId,
      title: "Untitled page",
      blockIds: [],
      backgroundColor: "#f8f6ef",
      gridEnabled: true,
      gridSize: GRID_SIZE,
      createdAt,
      updatedAt: createdAt,
    } satisfies SquarePage,
  };
}

function createInitialData(): SquareData {
  const first = createBookWithPage(1, 1);
  return {
    bookIds: [first.bookId],
    books: { [first.bookId]: first.book },
    pages: { [first.pageId]: first.page },
    blocks: {},
    counters: {
      nextBookNumber: 2,
      nextPageNumber: 2,
      nextBlockNumber: 1,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function migrateData(value: unknown): SquareData | null {
  if (!isRecord(value)) return null;

  if ("bookIds" in value && "books" in value && "pages" in value && "blocks" in value && "counters" in value) {
    const data = value as SquareData;
    return {
      ...data,
      blocks: Object.fromEntries(
        Object.entries(data.blocks).map(([id, block]) => [
          id,
          {
            ...block,
            style: normalizeBlockStyle(block.style),
          },
        ]),
      ),
    };
  }

  if (value.app === "Square" && value.version === "0.1" && "book" in value && "pages" in value && "blocks" in value) {
    const minimal = value as MinimalSquareState;
    const maxPageNumber = Object.values(minimal.pages).reduce((max, page) => Math.max(max, Number(page.code.replace(/\D/g, "")) || 1), 1);
    const maxBlockNumber = Object.values(minimal.blocks).reduce((max, block) => Math.max(max, Number(block.code.replace(/\D/g, "")) || 0), 0);

    return {
      bookIds: [minimal.book.id],
      books: {
        [minimal.book.id]: {
          ...minimal.book,
          pageIds: minimal.book.pageIds.filter((pageId) => minimal.pages[pageId]),
        },
      },
      pages: minimal.pages,
      blocks: Object.fromEntries(
        Object.entries(minimal.blocks).map(([id, block]) => [
          id,
          {
            ...block,
            style: normalizeBlockStyle(block.style),
          },
        ]),
      ),
      counters: {
        nextBookNumber: 2,
        nextPageNumber: Math.max(minimal.book.counters.nextPageNumber, maxPageNumber + 1),
        nextBlockNumber: Math.max(minimal.book.counters.nextBlockNumber, maxBlockNumber + 1),
      },
    };
  }

  if ("book" in value && "pages" in value && "blocks" in value) {
    const legacy = value as { book: SquareBook; pages: Record<string, SquarePage>; blocks: Record<string, SquareBlock> };
    return {
      bookIds: [legacy.book.id],
      books: { [legacy.book.id]: legacy.book },
      pages: legacy.pages,
      blocks: Object.fromEntries(
        Object.entries(legacy.blocks).map(([id, block]) => [
          id,
          {
            ...block,
            style: normalizeBlockStyle(block.style),
          },
        ]),
      ),
      counters: {
        nextBookNumber: 2,
        nextPageNumber: legacy.book.counters.nextPageNumber,
        nextBlockNumber: legacy.book.counters.nextBlockNumber,
      },
    };
  }

  return null;
}

function App() {
  const [data, setData] = useState<SquareData>(() => {
    const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(FALLBACK_STORAGE_KEY);
    if (!saved) return createInitialData();

    try {
      return migrateData(JSON.parse(saved)) ?? createInitialData();
    } catch {
      return createInitialData();
    }
  });
  const [activeBookId, setActiveBookId] = useState(() => data.bookIds[0]);
  const [currentPageId, setCurrentPageId] = useState(() => data.books[data.bookIds[0]]?.pageIds[0] ?? "");
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editingPageTitle, setEditingPageTitle] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [showCodes, setShowCodes] = useState(false);
  const [editMode, setEditMode] = useState<EditMode>("design");
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [showGridAlways, setShowGridAlways] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [alignmentGuide, setAlignmentGuide] = useState<AlignmentGuide | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const activeBook = data.books[activeBookId] ?? data.books[data.bookIds[0]];
  const currentPage = currentPageId ? data.pages[currentPageId] : undefined;
  const selectedBlock = selectedBlockId ? data.blocks[selectedBlockId] : undefined;
  const currentBlocks = useMemo(() => {
    if (!currentPage) return [];
    return currentPage.blockIds.map((id) => data.blocks[id]).filter(Boolean);
  }, [currentPage, data.blocks]);
  const currentPath = useMemo(() => {
    if (!activeBook || !currentPage) return [];
    const pages: SquarePage[] = [];
    let page: SquarePage | undefined = currentPage;
    while (page) {
      pages.unshift(page);
      page = page.parentPageId ? data.pages[page.parentPageId] : undefined;
    }
    return [activeBook.title, ...pages.map((item) => item.title)];
  }, [activeBook, currentPage, data.pages]);
  const showGrid = Boolean(currentPage?.gridEnabled && (dragState || snapToGrid || showGridAlways));
  const gridSize = currentPage?.gridSize || GRID_SIZE;
  const mobileTitle = currentPath.length > 0 ? currentPath.join(" / ") : "Square";
  const shellClassName = [
    "square-shell",
    `mode-${editMode}`,
    mobileSidebarOpen ? "sidebar-open" : "",
    mobileInspectorOpen ? "inspector-open" : "",
    mobileToolsOpen ? "tools-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      setToast("자동 저장됨");
    }, 250);
    return () => window.clearTimeout(timer);
  }, [data]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!activeBook) return;
    if (!activeBook.pageIds.includes(currentPageId)) {
      setCurrentPageId(activeBook.pageIds[0] ?? "");
      setSelectedBlockId(null);
      setEditingBlockId(null);
    }
  }, [activeBook, currentPageId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" || !selectedBlockId || editingBlockId) return;
      deleteBlock(selectedBlockId);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  function commitData(updater: (previous: SquareData) => SquareData, message?: string) {
    setData((previous) => updater(previous));
    if (message) setToast(message);
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "square-backup.json";
    link.click();
    URL.revokeObjectURL(url);
    setToast("백업 파일을 내보냈습니다");
  }

  function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = migrateData(JSON.parse(String(reader.result)));
        if (!imported) throw new Error("Invalid data");
        const nextBookId = imported.bookIds[0];
        setData(imported);
        setActiveBookId(nextBookId);
        setCurrentPageId(imported.books[nextBookId]?.pageIds[0] ?? "");
        setSelectedBlockId(null);
        setEditingBlockId(null);
        setToast("백업 파일을 불러왔습니다");
      } catch {
        setToast("백업 파일을 읽지 못했습니다");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  function addBook() {
    const bookNumber = data.counters.nextBookNumber;
    const pageNumber = data.counters.nextPageNumber;
    const created = createBookWithPage(bookNumber, pageNumber);
    commitData((previous) => ({
      ...previous,
      bookIds: [...previous.bookIds, created.bookId],
      books: { ...previous.books, [created.bookId]: created.book },
      pages: { ...previous.pages, [created.pageId]: created.page },
      counters: {
        ...previous.counters,
        nextBookNumber: bookNumber + 1,
        nextPageNumber: pageNumber + 1,
      },
    }), "Book을 추가했습니다");
    setActiveBookId(created.bookId);
    setCurrentPageId(created.pageId);
    setSelectedBlockId(null);
    setOpenMenuId(null);
  }

  function updateBookTitle(bookId: string, title: string) {
    commitData((previous) => ({
      ...previous,
      books: {
        ...previous.books,
        [bookId]: { ...previous.books[bookId], title, updatedAt: now() },
      },
    }));
  }

  function deleteBook(bookId: string) {
    const book = data.books[bookId];
    if (!book) return;
    const remainingBookIds = data.bookIds.filter((id) => id !== bookId);
    if (remainingBookIds.length === 0) {
      const created = createBookWithPage(data.counters.nextBookNumber, data.counters.nextPageNumber);
      setData({
        bookIds: [created.bookId],
        books: { [created.bookId]: created.book },
        pages: { [created.pageId]: created.page },
        blocks: {},
        counters: {
          nextBookNumber: data.counters.nextBookNumber + 1,
          nextPageNumber: data.counters.nextPageNumber + 1,
          nextBlockNumber: data.counters.nextBlockNumber,
        },
      });
      setActiveBookId(created.bookId);
      setCurrentPageId(created.pageId);
      setSelectedBlockId(null);
      setOpenMenuId(null);
      setToast("Book을 삭제했습니다");
      return;
    }

    const pageIdsToDelete = new Set(book.pageIds);
    const nextBooks = { ...data.books };
    const nextPages = { ...data.pages };
    const nextBlocks = { ...data.blocks };
    delete nextBooks[bookId];
    pageIdsToDelete.forEach((pageId) => {
      data.pages[pageId]?.blockIds.forEach((blockId) => delete nextBlocks[blockId]);
      delete nextPages[pageId];
    });
    const nextBookId = remainingBookIds[0];
    setData({ ...data, bookIds: remainingBookIds, books: nextBooks, pages: nextPages, blocks: nextBlocks });
    setActiveBookId(nextBookId);
    setCurrentPageId(nextBooks[nextBookId].pageIds[0] ?? "");
    setSelectedBlockId(null);
    setOpenMenuId(null);
    setToast("Book을 삭제했습니다");
  }

  function addPage(bookId: string, parentPageId?: string) {
    const book = data.books[bookId];
    if (!book) return;
    const timestamp = now();
    const pageNumber = data.counters.nextPageNumber;
    const pageId = createId("page");
    commitData((previous) => ({
      ...previous,
      books: {
        ...previous.books,
        [bookId]: {
          ...previous.books[bookId],
          pageIds: [...previous.books[bookId].pageIds, pageId],
          updatedAt: timestamp,
        },
      },
      pages: {
        ...previous.pages,
        [pageId]: {
          id: pageId,
          code: formatCode("P", pageNumber),
          bookId,
          parentPageId,
          title: parentPageId ? "Untitled subpage" : "Untitled page",
          blockIds: [],
          backgroundColor: "#f8f6ef",
          gridEnabled: true,
          gridSize: GRID_SIZE,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
      counters: { ...previous.counters, nextPageNumber: pageNumber + 1 },
    }), parentPageId ? "SubPage를 추가했습니다" : "Page를 추가했습니다");
    setActiveBookId(bookId);
    setCurrentPageId(pageId);
    setSelectedBlockId(null);
    setOpenMenuId(null);
  }

  function collectPageIds(pageId: string) {
    const ids = new Set([pageId]);
    let changed = true;
    while (changed) {
      changed = false;
      Object.values(data.pages).forEach((page) => {
        if (page.parentPageId && ids.has(page.parentPageId) && !ids.has(page.id)) {
          ids.add(page.id);
          changed = true;
        }
      });
    }
    return ids;
  }

  function deletePage(pageId: string) {
    const page = data.pages[pageId];
    if (!page) return;
    const book = data.books[page.bookId];
    const deleteIds = collectPageIds(pageId);
    const remainingPageIds = book.pageIds.filter((id) => !deleteIds.has(id));
    if (remainingPageIds.length === 0) return;

    commitData((previous) => {
      const nextPages = { ...previous.pages };
      const nextBlocks = { ...previous.blocks };
      deleteIds.forEach((id) => {
        previous.pages[id]?.blockIds.forEach((blockId) => delete nextBlocks[blockId]);
        delete nextPages[id];
      });
      return {
        ...previous,
        books: {
          ...previous.books,
          [book.id]: { ...previous.books[book.id], pageIds: remainingPageIds, updatedAt: now() },
        },
        pages: nextPages,
        blocks: nextBlocks,
      };
    }, "Page를 삭제했습니다");
    setCurrentPageId(remainingPageIds[0]);
    setSelectedBlockId(null);
    setOpenMenuId(null);
  }

  function selectPage(pageId: string) {
    const page = data.pages[pageId];
    if (!page) return;
    setActiveBookId(page.bookId);
    setCurrentPageId(page.id);
    setSelectedBlockId(null);
    setEditingBlockId(null);
    setEditingPageTitle(false);
    setMobileSidebarOpen(false);
    setMobileInspectorOpen(false);
    setMobileToolsOpen(false);
  }

  function updatePageTitle(pageId: string, title: string) {
    commitData((previous) => ({
      ...previous,
      pages: {
        ...previous.pages,
        [pageId]: { ...previous.pages[pageId], title, updatedAt: now() },
      },
    }));
  }

  function getCanvasBounds() {
    const rect = canvasRef.current?.getBoundingClientRect();
    const width = Math.floor(rect?.width ?? 1200);
    const height = Math.floor(rect?.height ?? 760);
    return {
      width: snapAtLeast(width, MIN_BLOCK_WIDTH, gridSize),
      height: snapAtLeast(height, MIN_BLOCK_HEIGHT, gridSize),
    };
  }

  function clampBlockRect(x: number, y: number, width: number, height: number, shouldSnap = false) {
    const bounds = getCanvasBounds();
    const minWidth = snapAtLeast(MIN_BLOCK_WIDTH, MIN_BLOCK_WIDTH, gridSize);
    const minHeight = snapAtLeast(MIN_BLOCK_HEIGHT, MIN_BLOCK_HEIGHT, gridSize);
    const nextWidth = Math.min(shouldSnap ? snapAtLeast(width, minWidth, gridSize) : Math.max(minWidth, width), bounds.width);
    const nextHeight = Math.min(shouldSnap ? snapAtLeast(height, minHeight, gridSize) : Math.max(minHeight, height), bounds.height);
    const clampedX = Math.min(Math.max(0, x), Math.max(0, bounds.width - nextWidth));
    const clampedY = Math.min(Math.max(0, y), Math.max(0, bounds.height - nextHeight));
    return {
      x: shouldSnap ? snap(clampedX, gridSize) : clampedX,
      y: shouldSnap ? snap(clampedY, gridSize) : clampedY,
      width: nextWidth,
      height: nextHeight,
    };
  }

  function getAlignmentGuide(blockId: string, x: number, y: number, width: number, height: number): AlignmentGuide | null {
    const bounds = getCanvasBounds();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const guide: AlignmentGuide = {};

    if (Math.abs(centerX - bounds.width / 2) <= GUIDE_THRESHOLD) guide.x = bounds.width / 2;
    if (Math.abs(centerY - bounds.height / 2) <= GUIDE_THRESHOLD) guide.y = bounds.height / 2;

    currentBlocks.forEach((block) => {
      if (block.id === blockId) return;
      const otherCenterX = block.x + block.width / 2;
      const otherCenterY = block.y + block.height / 2;
      if (Math.abs(centerX - otherCenterX) <= GUIDE_THRESHOLD) guide.x = otherCenterX;
      if (Math.abs(centerY - otherCenterY) <= GUIDE_THRESHOLD) guide.y = otherCenterY;
    });

    return guide.x || guide.y ? guide : null;
  }

  function addBlockAt(x?: number, y?: number) {
    if (!currentPage || !activeBook) return;
    const timestamp = now();
    const blockNumber = data.counters.nextBlockNumber;
    const blockId = createId("block");
    const rect = clampBlockRect(
      x ?? 72 + currentPage.blockIds.length * 16,
      y ?? 64 + currentPage.blockIds.length * 16,
      216,
      108,
      true,
    );
    commitData((previous) => ({
      ...previous,
      pages: {
        ...previous.pages,
        [currentPage.id]: {
          ...previous.pages[currentPage.id],
          blockIds: [...previous.pages[currentPage.id].blockIds, blockId],
          updatedAt: timestamp,
        },
      },
      blocks: {
        ...previous.blocks,
        [blockId]: {
          id: blockId,
          code: formatCode("B", blockNumber),
          bookId: activeBook.id,
          pageId: currentPage.id,
          type: "text",
          role: "content",
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          content: { text: "New text block" },
          value: null,
          style: defaultBlockStyle(),
          visible: true,
          locked: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
      counters: { ...previous.counters, nextBlockNumber: blockNumber + 1 },
    }), "Block을 추가했습니다");
    setSelectedBlockId(blockId);
  }

  function addBlock() {
    addBlockAt();
  }

  function updateBlock(blockId: string, patch: Partial<SquareBlock>) {
    commitData((previous) => ({
      ...previous,
      blocks: {
        ...previous.blocks,
        [blockId]: { ...previous.blocks[blockId], ...patch, updatedAt: now() },
      },
    }));
  }

  function updateBlockStyle(blockId: string, patch: Partial<SquareBlockStyle>) {
    const block = data.blocks[blockId];
    if (!block) return;
    const nextPatch = "backgroundColor" in patch && !("fillEnabled" in patch) ? { ...patch, fillEnabled: true } : patch;
    updateBlock(blockId, { style: { ...normalizeBlockStyle(block.style), ...nextPatch } });
  }

  function deleteBlock(blockId: string) {
    const block = data.blocks[blockId];
    if (!block) return;
    commitData((previous) => {
      const { [blockId]: _deleted, ...remainingBlocks } = previous.blocks;
      return {
        ...previous,
        blocks: remainingBlocks,
        pages: {
          ...previous.pages,
          [block.pageId]: {
            ...previous.pages[block.pageId],
            blockIds: previous.pages[block.pageId].blockIds.filter((id) => id !== blockId),
            updatedAt: now(),
          },
        },
      };
    }, "Block을 삭제했습니다");
    setSelectedBlockId(null);
    setEditingBlockId(null);
    setMobileInspectorOpen(false);
  }

  function startMove(event: PointerEvent<HTMLDivElement>, block: SquareBlock) {
    if (editingBlockId === block.id) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedBlockId(block.id);
    setDragState({
      mode: "move",
      blockId: block.id,
      startX: event.clientX,
      startY: event.clientY,
      originalX: block.x,
      originalY: block.y,
    });
  }

  function startResize(event: PointerEvent<HTMLButtonElement>, block: SquareBlock) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedBlockId(block.id);
    setDragState({
      mode: "resize",
      blockId: block.id,
      startX: event.clientX,
      startY: event.clientY,
      originalWidth: block.width,
      originalHeight: block.height,
    });
  }

  function startTextMove(event: PointerEvent<HTMLDivElement>, block: SquareBlock) {
    if (editingBlockId === block.id || selectedBlockId !== block.id) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const style = normalizeBlockStyle(block.style);
    setDragState({
      mode: "text",
      blockId: block.id,
      startX: event.clientX,
      startY: event.clientY,
      originalTextOffsetX: style.textOffsetX,
      originalTextOffsetY: style.textOffsetY,
    });
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragState) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (dragState.mode === "move") {
      const block = data.blocks[dragState.blockId];
      if (!block) return;
      const nextX = dragState.originalX + dx;
      const nextY = dragState.originalY + dy;
      const rect = clampBlockRect(
        snapToGrid ? snap(nextX, gridSize) : nextX,
        snapToGrid ? snap(nextY, gridSize) : nextY,
        block.width,
        block.height,
        snapToGrid,
      );
      setAlignmentGuide(getAlignmentGuide(block.id, rect.x, rect.y, rect.width, rect.height));
      updateBlock(dragState.blockId, {
        x: rect.x,
        y: rect.y,
      });
      return;
    }
    if (dragState.mode === "text") {
      updateBlockStyle(dragState.blockId, {
        textOffsetX: snapToGrid ? snap(dragState.originalTextOffsetX + dx, gridSize) : dragState.originalTextOffsetX + dx,
        textOffsetY: snapToGrid ? snap(dragState.originalTextOffsetY + dy, gridSize) : dragState.originalTextOffsetY + dy,
      });
      return;
    }
    const block = data.blocks[dragState.blockId];
    if (!block) return;
    const nextWidth = Math.max(MIN_BLOCK_WIDTH, dragState.originalWidth + dx);
    const nextHeight = Math.max(MIN_BLOCK_HEIGHT, dragState.originalHeight + dy);
    const rect = clampBlockRect(
      block.x,
      block.y,
      snapToGrid ? Math.max(MIN_BLOCK_WIDTH, snap(nextWidth, gridSize)) : nextWidth,
      snapToGrid ? Math.max(MIN_BLOCK_HEIGHT, snap(nextHeight, gridSize)) : nextHeight,
      snapToGrid,
    );
    setAlignmentGuide(getAlignmentGuide(block.id, rect.x, rect.y, rect.width, rect.height));
    updateBlock(dragState.blockId, {
      width: rect.width,
      height: rect.height,
    });
  }

  function stopDragging() {
    setDragState(null);
    setAlignmentGuide(null);
  }

  function renderPageTree(book: SquareBook, parentPageId?: string, depth = 0) {
    const pages = book.pageIds.map((pageId) => data.pages[pageId]).filter((page) => page && page.parentPageId === parentPageId);
    return pages.map((page) => (
      <div className="tree-row-wrap" key={page.id}>
        <div className={page.id === currentPageId ? "tree-row page active" : "tree-row page"} style={{ paddingLeft: `${depth * 16 + 10}px` }}>
          <button className="tree-title" onClick={() => selectPage(page.id)} title={page.title}>
            <SquareIcon src={page.parentPageId ? ICONS.subpage : ICONS.page} size={17} />
            <span className="tree-name">{page.title}</span>
            {showCodes && <span className="tree-code">{page.code}</span>}
          </button>
          <div className="tree-actions">
            <button className="icon-button" title="SubPage 추가" onClick={() => addPage(book.id, page.id)}>
              +
            </button>
            <button className="icon-button" title="Page 메뉴" onClick={() => setOpenMenuId(openMenuId === page.id ? null : page.id)}>
              ...
            </button>
          </div>
          {openMenuId === page.id && (
            <div className="tree-menu">
              <button onClick={() => deletePage(page.id)}>삭제</button>
            </div>
          )}
        </div>
        {renderPageTree(book, page.id, depth + 1)}
      </div>
    ));
  }

  return (
    <div className={shellClassName}>
      <header className="topbar">
        <div className="brand">
          <SquareIcon src={ICONS.logo} size={42} />
          <div>
            <div className="app-name">Square</div>
            <div className="mobile-current-title">{mobileTitle}</div>
            <div className="app-meta">개인용 블록 캔버스</div>
          </div>
        </div>
        <div className="mobile-top-actions">
          <button className="mobile-nav-button" onClick={() => setMobileSidebarOpen((open) => !open)}>
            탐색
          </button>
          <button className="mobile-nav-button" onClick={() => setMobileToolsOpen((open) => !open)}>
            도구
          </button>
          <button
            className="mobile-nav-button"
            disabled={!selectedBlock}
            onClick={() => setMobileInspectorOpen((open) => !open)}
          >
            속성
          </button>
        </div>
      </header>

      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="panel-title">Books</div>
          <div className="sidebar-head-actions">
            <button className="mini-action" onClick={addBook}>+ Book</button>
            <button className="mobile-close-button" onClick={() => setMobileSidebarOpen(false)}>닫기</button>
          </div>
        </div>
        <nav className="book-tree">
          {data.bookIds.map((bookId) => {
            const book = data.books[bookId];
            if (!book) return null;
            return (
              <div className="book-group" key={book.id}>
                <div className={book.id === activeBookId ? "tree-row book active" : "tree-row book"}>
                  {book.id === activeBookId ? (
                    <div className="tree-edit-title">
                      <SquareIcon src={ICONS.book} size={19} />
                      <input value={book.title} onChange={(event) => updateBookTitle(book.id, event.target.value)} />
                      {showCodes && <span className="tree-code">{book.code}</span>}
                    </div>
                  ) : (
                    <button
                      className="tree-title"
                      onClick={() => {
                        setActiveBookId(book.id);
                        setCurrentPageId(book.pageIds[0] ?? "");
                        setSelectedBlockId(null);
                        setEditingBlockId(null);
                      }}
                      title={book.title}
                    >
                      <SquareIcon src={ICONS.book} size={19} />
                      <span className="tree-name">{book.title}</span>
                      {showCodes && <span className="tree-code">{book.code}</span>}
                    </button>
                  )}
                  <div className="tree-actions">
                    <button className="icon-button" title="Page 추가" onClick={() => addPage(book.id)}>
                      +
                    </button>
                    <button className="icon-button" title="Book 메뉴" onClick={() => setOpenMenuId(openMenuId === book.id ? null : book.id)}>
                      ...
                    </button>
                  </div>
                  {openMenuId === book.id && (
                    <div className="tree-menu">
                      <button onClick={() => deleteBook(book.id)}>삭제</button>
                    </div>
                  )}
                </div>
                <div className="page-tree">{renderPageTree(book)}</div>
              </div>
            );
          })}
        </nav>
        <div className="sidebar-tools">
          <button className="plain-tool" onClick={exportBackup}>백업 내보내기</button>
          <button className="plain-tool" onClick={() => importInputRef.current?.click()}>백업 불러오기</button>
          <label className="plain-tool checkbox-tool">
            <input type="checkbox" checked={showCodes} onChange={(event) => setShowCodes(event.target.checked)} />
            코드 표시
          </label>
          <input ref={importInputRef} className="hidden-input" type="file" accept="application/json" onChange={importBackup} />
        </div>
      </aside>

      <main className="workspace">
        {currentPage && (
          <>
            <div className="canvas-toolbar">
              {editingPageTitle ? (
                <input
                  autoFocus
                  className="page-title-input"
                  value={currentPage.title}
                  onBlur={() => setEditingPageTitle(false)}
                  onChange={(event) => updatePageTitle(currentPage.id, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") setEditingPageTitle(false);
                  }}
                />
              ) : (
                <button className="breadcrumb" onClick={() => setEditingPageTitle(true)}>
                  {currentPath.map((item, index) => (
                    <span key={`${item}-${index}`}>
                      {item}
                      {index < currentPath.length - 1 && <b>/</b>}
                    </span>
                  ))}
                </button>
              )}
              <div className="canvas-actions">
                <div className="edit-mode-tabs" aria-label="edit mode">
                  {(["design", "content", "function"] as EditMode[]).map((mode) => (
                    <button className={editMode === mode ? "active" : ""} key={mode} onClick={() => setEditMode(mode)}>
                      {mode === "design" ? "디자인" : mode === "content" ? "콘텐츠" : "기능"}
                    </button>
                  ))}
                </div>
                <label className="toolbar-toggle">
                  <input type="checkbox" checked={showGridAlways} onChange={(event) => setShowGridAlways(event.target.checked)} />
                  그리드
                </label>
                <label className="toolbar-toggle">
                  <input type="checkbox" checked={snapToGrid} onChange={(event) => setSnapToGrid(event.target.checked)} />
                  정렬 모드
                </label>
                <button className="primary-button desktop-add-button" onClick={addBlock}>
                  <SquareIcon src={ICONS.block} size={17} />
                  Block 추가
                </button>
              </div>
            </div>
            <div
              ref={canvasRef}
              className={showGrid ? "canvas grid-visible" : "canvas"}
              style={{ backgroundColor: currentPage.backgroundColor, backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px` }}
              onPointerMove={handlePointerMove}
              onPointerUp={stopDragging}
              onPointerLeave={stopDragging}
              onContextMenu={(event) => {
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                addBlockAt(event.clientX - rect.left, event.clientY - rect.top);
              }}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setSelectedBlockId(null);
                  setEditingBlockId(null);
                }
              }}
            >
              {currentBlocks.map((block) => {
                const style = normalizeBlockStyle(block.style);
                return (
                  <div
                    className={[
                      "block",
                      block.id === selectedBlockId ? "selected" : "",
                      showCodes && block.id === selectedBlockId ? "has-code" : "",
                      !style.fillEnabled ? "no-fill" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={block.id}
                    style={{
                      left: block.x,
                      top: block.y,
                      width: block.width,
                      height: block.height,
                      backgroundColor: style.fillEnabled ? style.backgroundColor : "transparent",
                      color: style.textColor,
                      fontSize: style.fontSize,
                      fontWeight: style.fontWeight,
                      borderRadius: style.borderRadius,
                      boxShadow: style.shadow ? "0 10px 24px rgba(32, 33, 36, 0.14)" : "none",
                    }}
                    onPointerDown={(event) => startMove(event, block)}
                    onDoubleClick={() => {
                      setSelectedBlockId(block.id);
                      setEditingBlockId(block.id);
                    }}
                  >
                    {showCodes && block.id === selectedBlockId && <div className="block-code">{block.code}</div>}
                    {editingBlockId === block.id ? (
                      <textarea
                        autoFocus
                        value={block.content.text ?? ""}
                        onChange={(event) => updateBlock(block.id, { content: { ...block.content, text: event.target.value } })}
                        onBlur={() => setEditingBlockId(null)}
                        onPointerDown={(event) => event.stopPropagation()}
                      />
                    ) : (
                      <div
                        className="block-text"
                        style={{ left: 10 + style.textOffsetX, top: (showCodes && block.id === selectedBlockId ? 30 : 10) + style.textOffsetY, textAlign: style.textAlign }}
                        onPointerDown={(event) => startTextMove(event, block)}
                      >
                        {block.content.text}
                      </div>
                    )}
                    <button className="resize-handle" aria-label="resize block" onPointerDown={(event) => startResize(event, block)} />
                  </div>
                );
              })}
              {alignmentGuide?.x !== undefined && <div className="alignment-guide vertical" style={{ left: alignmentGuide.x }} />}
              {alignmentGuide?.y !== undefined && <div className="alignment-guide horizontal" style={{ top: alignmentGuide.y }} />}
            </div>
          </>
        )}
      </main>

      <aside className="inspector">
        <div className="inspector-head">
          <div className="panel-title">Properties</div>
          <button className="mobile-close-button" onClick={() => setMobileInspectorOpen(false)}>닫기</button>
        </div>
        {selectedBlock ? (
          <div className="property-list">
            {showCodes && <div className="selected-code">{selectedBlock.code}</div>}
            <section className="property-section content-section">
              <h2>Text</h2>
              <label>
                내용
                <textarea value={selectedBlock.content.text ?? ""} onChange={(event) => updateBlock(selectedBlock.id, { content: { ...selectedBlock.content, text: event.target.value } })} />
              </label>
              <div className="split-row">
                <label>
                  글자 크기
                  <input type="number" min="10" max="72" value={normalizeBlockStyle(selectedBlock.style).fontSize} onChange={(event) => updateBlockStyle(selectedBlock.id, { fontSize: Number(event.target.value) })} />
                </label>
                <label>
                  글자색
                  <input type="color" value={normalizeBlockStyle(selectedBlock.style).textColor} onChange={(event) => updateBlockStyle(selectedBlock.id, { textColor: event.target.value })} />
                </label>
              </div>
              <div className="segmented">
                {(["left", "center", "right"] as TextAlign[]).map((value) => (
                  <button className={normalizeBlockStyle(selectedBlock.style).textAlign === value ? "active" : ""} key={value} onClick={() => updateBlockStyle(selectedBlock.id, { textAlign: value })}>
                    {value === "left" ? "좌" : value === "center" ? "중" : "우"}
                  </button>
                ))}
              </div>
              <label className="checkbox-row">
                <input type="checkbox" checked={normalizeBlockStyle(selectedBlock.style).fontWeight === "bold"} onChange={(event) => updateBlockStyle(selectedBlock.id, { fontWeight: event.target.checked ? "bold" : "normal" })} />
                Bold
              </label>
            </section>
            <section className="property-section design-section">
              <h2>Block</h2>
              <label className="checkbox-row">
                <input type="checkbox" checked={!normalizeBlockStyle(selectedBlock.style).fillEnabled} onChange={(event) => updateBlockStyle(selectedBlock.id, { fillEnabled: !event.target.checked })} />
                채우기 없음
              </label>
              <div className="swatches">
                {PASTEL_SWATCHES.map((color) => (
                  <button
                    className={[
                      normalizeBlockStyle(selectedBlock.style).fillEnabled && normalizeBlockStyle(selectedBlock.style).backgroundColor === color ? "swatch active" : "swatch",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={color}
                    style={{ backgroundColor: color === "transparent" ? "transparent" : color }}
                    title={color === "transparent" ? "배경 없음" : color}
                    onClick={() => updateBlockStyle(selectedBlock.id, { backgroundColor: color })}
                  />
                ))}
              </div>
              <label>
                배경색
                <input type="color" value={normalizeBlockStyle(selectedBlock.style).backgroundColor === "transparent" ? "#ffffff" : normalizeBlockStyle(selectedBlock.style).backgroundColor} onChange={(event) => updateBlockStyle(selectedBlock.id, { backgroundColor: event.target.value })} />
              </label>
              <label>
                테두리 둥글기
                <input type="range" min="0" max="32" value={normalizeBlockStyle(selectedBlock.style).borderRadius} onChange={(event) => updateBlockStyle(selectedBlock.id, { borderRadius: Number(event.target.value) })} />
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={normalizeBlockStyle(selectedBlock.style).shadow} onChange={(event) => updateBlockStyle(selectedBlock.id, { shadow: event.target.checked })} />
                그림자
              </label>
            </section>
            <section className="property-section design-section">
              <h2>Layout</h2>
              <div className="size-grid">
                <label>X<input type="number" value={Math.round(selectedBlock.x)} onChange={(event) => updateBlock(selectedBlock.id, clampBlockRect(Number(event.target.value), selectedBlock.y, selectedBlock.width, selectedBlock.height))} /></label>
                <label>Y<input type="number" value={Math.round(selectedBlock.y)} onChange={(event) => updateBlock(selectedBlock.id, clampBlockRect(selectedBlock.x, Number(event.target.value), selectedBlock.width, selectedBlock.height))} /></label>
                <label>W<input type="number" value={Math.round(selectedBlock.width)} onChange={(event) => updateBlock(selectedBlock.id, clampBlockRect(selectedBlock.x, selectedBlock.y, Number(event.target.value), selectedBlock.height))} /></label>
                <label>H<input type="number" value={Math.round(selectedBlock.height)} onChange={(event) => updateBlock(selectedBlock.id, clampBlockRect(selectedBlock.x, selectedBlock.y, selectedBlock.width, Number(event.target.value)))} /></label>
              </div>
            </section>
            <button className="danger-button" onClick={() => deleteBlock(selectedBlock.id)}>Block 삭제</button>
          </div>
        ) : (
          <p className="empty-state">선택된 Block이 없습니다.</p>
        )}
      </aside>
      {selectedBlock && (
        <div className="mobile-block-toolbar">
          <button onClick={() => setEditingBlockId(selectedBlock.id)}>편집</button>
          <button onClick={() => setMobileInspectorOpen(true)}>속성</button>
          <button className="danger-button" onClick={() => deleteBlock(selectedBlock.id)}>삭제</button>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default App;

import { EditorProvider } from "./editor/EditorProvider";
import { CommandsProvider } from "./editor/commands";
import { DocumentActionsProvider } from "./state/actions";
import { AppStoreProvider, useApp } from "./state/store";
import { Backstage } from "./components/backstage/Backstage";
import { CommandPalette } from "./components/dialogs/CommandPalette";
import { HeaderFooterDialog } from "./components/dialogs/HeaderFooterDialog";
import { StyleDialog } from "./components/dialogs/StyleDialog";
import { TableSizeDialog } from "./components/dialogs/TableSizeDialog";
import { BookmarkDialog, ChartDialog, CoverPageDialog, CrossRefDialog, EquationDialog, IconsDialog } from "./components/dialogs/InsertDialogs";
import { AboutDialog, ImportReportDialog, MarginsDialog, LinkDialog, LossySaveDialog, PreferencesDialog, UnsavedDialog, WordCountDialog } from "./components/dialogs/Dialogs";
import { FindBar } from "./components/layout/FindBar";
import { DocumentCanvas } from "./components/layout/DocumentCanvas";
import { NavigationPane } from "./components/layout/NavigationPane";
import { Ribbon } from "./components/layout/Ribbon";
import { StatusBar } from "./components/layout/StatusBar";
import { TitleBar } from "./components/layout/TitleBar";
import { Toast } from "./components/ui/Toast";

function Shell() {
  const { state } = useApp();
  return (
    <div className="flex h-full flex-col overflow-hidden bg-chrome text-fg">
      <TitleBar />
      {state.view === "backstage" && <Backstage />}
      {/* The editor view stays mounted behind the backstage: TipTap's view only exists once mounted. */}
      <div className={state.view === "backstage" ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
        <Ribbon />
        {state.find.open && <FindBar />}
        <div className="flex min-h-0 flex-1">
          {state.navPane && <NavigationPane />}
          <DocumentCanvas />
        </div>
        <StatusBar />
      </div>
      {state.dialog === "preferences" && <PreferencesDialog />}
      {state.dialog === "about" && <AboutDialog />}
      {state.dialog === "link" && <LinkDialog />}
      {state.dialog === "wordCount" && <WordCountDialog />}
      {state.dialog === "unsaved" && <UnsavedDialog />}
      {state.dialog === "coverPage" && <CoverPageDialog />}
      {state.dialog === "icons" && <IconsDialog />}
      {state.dialog === "chart" && <ChartDialog />}
      {state.dialog === "bookmark" && <BookmarkDialog />}
      {state.dialog === "crossRef" && <CrossRefDialog />}
      {state.dialog === "equation" && <EquationDialog />}
      {state.dialog === "headerFooter" && <HeaderFooterDialog />}
      {state.dialog === "styles" && <StyleDialog />}
      {state.dialog === "tableSize" && <TableSizeDialog />}
      {state.dialog === "margins" && <MarginsDialog />}
      {state.dialog === "importReport" && <ImportReportDialog />}
      {state.dialog === "lossySave" && <LossySaveDialog />}
      {state.dialog === "palette" && <CommandPalette />}
      <Toast />
    </div>
  );
}

export default function App() {
  return (
    <AppStoreProvider>
      <EditorProvider>
        <DocumentActionsProvider>
          <CommandsProvider>
            <Shell />
          </CommandsProvider>
        </DocumentActionsProvider>
      </EditorProvider>
    </AppStoreProvider>
  );
}

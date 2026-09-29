import { FlatList, Pressable, Switch, Text, View } from "react-native";
import { Ionicons } from "@react-native-vector-icons/ionicons";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import type { BottomSheetModal as BSM } from "@gorhom/bottom-sheet";

import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { useT } from "@/src/lib/i18n";
import { PROVIDER_NAMES, type VoiceModel } from "@/src/lib/api";

type Props = {
  sheetRef: React.RefObject<BSM | null>;
  voices: VoiceModel[];
  activeId: string | null;
  onSelect: (vm: VoiceModel) => void;
  autoSpeak: boolean;
  onToggleAutoSpeak: (v: boolean) => void;
};

export function VoicePicker({ sheetRef, voices, activeId, onSelect, autoSpeak, onToggleAutoSpeak }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const snapPoints = [Math.min(voices.length * 72 + 190, 600), 600];

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      backgroundStyle={styles.sheetBg}
      handleIndicatorStyle={styles.handle}
      enableDynamicSizing={false}
    >
      <View style={styles.container}>
        <Text style={styles.title}>{t.chooseVoice}</Text>
        <FlatList
          data={voices}
          keyExtractor={(v) => v.id}
          renderItem={({ item }) => {
            const active = item.id === activeId;
            return (
              <Pressable
                testID={`voice-option-${item.id}`}
                style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && { opacity: 0.8 }]}
                onPress={() => onSelect(item)}
              >
                <Ionicons
                  name={item.gender === "male" ? "man" : "woman"}
                  size={22}
                  color={active ? colors.brandPrimary : colors.muted}
                />
                <View style={styles.rowText}>
                  <Text style={[styles.rowLabel, active && { color: colors.brandPrimary }]}>{item.label}</Text>
                  <Text style={styles.rowSub}>
                    {PROVIDER_NAMES[item.provider] ?? item.provider} · {item.voice_id}
                  </Text>
                </View>
                {active ? (
                  <Ionicons name="checkmark-circle" size={22} color={colors.brandPrimary} />
                ) : null}
              </Pressable>
            );
          }}
          showsVerticalScrollIndicator={false}
        />
        <View style={styles.autoRow}>
          <Text style={styles.autoText}>{t.autospeak}</Text>
          <Switch
            testID="autospeak-switch"
            value={autoSpeak}
            onValueChange={onToggleAutoSpeak}
            trackColor={{ false: colors.border, true: colors.brandPrimary }}
            thumbColor="#FFFFFF"
          />
        </View>
      </View>
    </BottomSheetModal>
  );
}

const useStyles = makeStyles((colors) => ({
  sheetBg: { backgroundColor: colors.surface },
  handle: { backgroundColor: colors.border },
  container: { flex: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  autoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: spacing.md,
    marginTop: spacing.xs,
    minHeight: 48,
  },
  autoText: { color: colors.onSurface, fontSize: 15, fontWeight: "600", writingDirection: "rtl", textAlign: "right" },
  title: {
    color: colors.onSurface,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    minHeight: 56,
  },
  rowActive: { backgroundColor: colors.brandTertiary },
  rowText: { flex: 1 },
  rowLabel: { color: colors.onSurface, fontSize: 16, fontWeight: "600", textAlign: "right", writingDirection: "rtl" },
  rowSub: { color: colors.muted, fontSize: 12, marginTop: 2, textAlign: "right", writingDirection: "rtl" },
}));
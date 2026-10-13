import prepositions from "./prepositions.json" with { type: "json" };
import articles from "./articles.json" with { type: "json" };
import verbTenses from "./verb-tenses.json" with { type: "json" };
import verbForms from "./verb-forms.json" with { type: "json" };
import wordChoice from "./word-choice.json" with { type: "json" };
import sentenceStructure from "./sentence-structure.json" with { type: "json" };
import pluralAgreement from "./plural-agreement.json" with { type: "json" };
import other from "./other.json" with { type: "json" };

export const spotExtrasByLesson = {
  prepositions,
  articles,
  "verb-tenses": verbTenses,
  "verb-forms": verbForms,
  "word-choice": wordChoice,
  "sentence-structure": sentenceStructure,
  "plural-agreement": pluralAgreement,
  other,
};

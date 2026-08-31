# Politique de Confidentialité — ft-Transcendence (RetroLudo '42)

**Date d'entrée en vigueur :** 2026-08-26
**Responsable :** Team Pace 24, développeurs de ft-Transcendence (RetroLudo '42) (les « Team »)

Cette Politique de Confidentialité explique comment l'application web ft-Transcendence (RetroLudo '42) (« l'App », « nous », « nous ») collecte, utilise, divulgue et protège vos données personnelles. Elle est élaborée conformément à la **Loi malaisienne sur la protection des données personnelles 2010 (« PDPA »)** et à ses principes directeurs : Général, Avis et Choix, Divulgation, Sécurité, Conservation, Intégrité des Données et Accès.

---

## 1. Quelles données personnelles nous collectons

L'App collecte uniquement les données nécessaires pour fournir le jeu et ses fonctions de compte :

| Catégorie | Données | Source |
|---|---|---|
| Identifiants de compte | nom d'utilisateur, nom affiché, adresse e-mail | vous les fournissez lors de l'inscription |
| Authentification | mot de passe (stocké uniquement sous forme de hachage bcrypt — jamais en clair) | vous le fournissez |
| Identifiants OAuth | nom du fournisseur et ID de compte du fournisseur (Google, GitHub, ou 42) | fournisseur OAuth, uniquement si vous choisissez de vous connecter avec |
| Profil | image d'avatar personnalisée (si téléchargée), style d'avatar par défaut | vous le fournissez |
| Activité de jeu | historique des parties, résultats de jeu, notes, statistiques de victoires/défaites/séries | généré par votre jeu |
| Social | liste d'amis, demandes d'amis, listes de blocage, invitations aux parties | généré par votre activité dans l'app |
| Technique | présence/statut en ligne, préférences de notification | généré par l'utilisation de l'App |

Nous ne collectons **pas** de coordonnées de carte de paiement, de données de localisation, ou de données provenant d'enfants de moins de 13 ans. L'App est un jeu et ne procède à aucun profilage automatisé au-delà de l'affichage des statistiques de jeu que vous voyez déjà.

---

## 2. Avis et choix (consentement)

En créant un compte et en utilisant l'App, vous consentez à la collecte et à l'utilisation de vos données personnelles comme décrit dans cette Politique. La connexion avec un fournisseur externe (Google, GitHub, 42) est facultative et ne se produit que lorsque vous choisissez cette méthode de connexion.

- Vous pouvez retirer votre consentement en supprimant votre compte à tout moment (voir Section 7).
- Lorsque des données facultatives sont impliquées (par ex., télécharger un avatar, lier une méthode OAuth), elles ne sont collectées que sur votre choix exprès.

---

## 3. Comment nous utilisons vos données

Nous utilisons vos données personnelles uniquement pour :

- Créer et gérer votre compte
- Vous authentifier (e-mail/mot de passe ou OAuth)
- Organiser des parties, enregistrer les résultats, et maintenir les classements et les statistiques
- Gérer les amis, les notifications, et le statut de présence
- Vérifier votre adresse e-mail et sécuriser votre compte (authentification à deux facteurs)
- Répondre à vos demandes et fournir un soutien

Nous ne vendons, ne louons **ni n'échangeons** vos données personnelles, et nous ne les utilisons pas pour le marketing ou la publicité.

---

## 4. Divulgation

Vos données sont divulguées uniquement selon les besoins pour faire fonctionner l'App :

- **Dans l'App** : les résultats de jeu, les noms d'utilisateur, et la présence sont affichés aux autres joueurs dans le cadre du jeu (par ex., classements, listes d'amis, historiques de parties). Votre **adresse e-mail et mot de passe** ne sont jamais affichés aux autres joueurs.
- **Fournisseurs de services** : l'App fonctionne sur une infrastructure auto-hébergée (conteneurs Docker) et utilise des fournisseurs OAuth tiers (Google, GitHub, 42) ainsi que des services de messagerie électronique uniquement pour fournir les fonctionnalités que vous utilisez.
- **Conformité légale** : nous pouvons divulguer des données si nous y sommes tenus par la loi ou par une autorité compétente.

Nous ne transférons pas vos données personnelles au-delà des finalités décrites ici sans votre consentement, sauf lorsque cela est nécessaire pour fournir le service.

## 5. Sécurité

Nous appliquons des mesures techniques et organisationnelles raisonnables pour protéger vos données, notamment :

- Mots de passe stockés uniquement sous forme de **hachage bcrypt** (salé)
- Jetons de session stockés dans des **cookies httpOnly**, avec des jetons d'accès à courte durée de vie et des jetons de rafraîchissement révoquables
- Authentification à deux facteurs (2FA) disponible via des codes e-mail
- Transport chiffré avec **HTTPS/TLS** à la passerelle publique
- Accès aux secrets de configuration restreint et non stocké dans le contrôle de code source
- Identifiants OAuth établis via des flux d'autorisation sécurisés des fournisseurs

Étant donné que l'App est un projet de développement/évaluation auto-hébergé, le déploiement utilise un **certificat TLS autosigné** ; la connexion reste chiffrée, mais n'est pas validée par des autorités de certification publiques. Vous ne devriez pas utiliser l'App pour stocker des données hautement sensibles.

---

## 6. Conservation

Nous conservons vos données personnelles uniquement pour la durée de vie de votre compte et selon les besoins pour fournir les fonctionnalités que vous utilisez. Les données éphémères (état de partie en direct, présence, notifications, jetons de sécurité temporaires) sont conservées en mémoire avec une expiration automatique. Lorsque vous supprimez votre compte, vos données personnelles sont supprimées (voir Section 7).

---

## 7. Intégrité des données, accès et correction (vos droits en vertu de la PDPA)

En vertu de la PDPA, vous avez le droit de :

- **Accéder** : demander une copie des données personnelles que nous détenons sur vous.
- **Corriger** : mettre à jour ou corriger vos données (vous pouvez également modifier la plupart vous-même dans votre profil).
- **Retrait / suppression** : demander la suppression de votre compte et de vos données.

**Suppression de votre compte.** Vous pouvez supprimer votre compte directement dans l'App (via votre profil). La suppression de votre compte :

- Supprime définitivement votre profil, l'historique des parties, les succès, les amis, les notifications, et l'avatar téléchargé ;
- Retire vos données du classement ; et
- Déconnecte votre session sur tous les appareils.

Pour toute demande d'accès, de correction, ou autre, contactez l'équipe (voir Section 9).

---

## 8. Intégrité des données

Nous prenons des mesures raisonnables pour nous assurer que les données personnelles que nous détenons sont exactes, complètes et non trompeuses, et nous les corrigeons ou les mettons à jour lorsque vous nous en informez ou les modifiez vous-même.

---

## 9. Contact

Pour toute question, réclamation ou demande concernant vos données personnelles en vertu de la PDPA, veuillez contacter l'équipe via les canaux de contact du projet (tels que répertoriés dans le README du projet).

---

## 10. Modifications de cette Politique

Nous pouvons mettre à jour cette Politique de Confidentialité de temps à autre. La version actuelle sera toujours disponible dans l'App. Votre utilisation continue de l'App après les modifications de cette Politique constitue votre acceptation de la Politique mise à jour.

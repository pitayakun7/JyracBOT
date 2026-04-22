const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField } = require('discord.js');
const express = require('express');

// --- 1. Botの初期化 ---
const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] 
});

// --- 2. スラッシュコマンド定義 ---
const commands = [
    new SlashCommandBuilder().setName('verify').setDescription('認証パネル')
        .addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('説明文').setRequired(false)),
    new SlashCommandBuilder().setName('ticket').setDescription('チケットパネル')
        .addRoleOption(o => o.setName('admin-role').setDescription('管理者ロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('説明文').setRequired(false))
        .addStringOption(o => o.setName('panel-desc').setDescription('チケット発行後のメッセージ').setRequired(false)),
    new SlashCommandBuilder().setName('role-confirmation').setDescription('ロール確認')
        .addUserOption(o => o.setName('target').setDescription('対象').setRequired(true))
].map(c => c.toJSON());

// --- 3. 起動時にコマンドを自動登録 ---
client.once('clientReady', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('コマンド登録完了！');
    } catch (error) {
        console.error('コマンド登録エラー:', error);
    }
});

// --- 4. Webサーバー (Render維持用) ---
const app = express();
app.get('/', (req, res) => res.send('Bot is active!'));
app.listen(3000);

// --- 5. メイン処理 ---
client.on('interactionCreate', async interaction => {
    // [コマンド処理]
    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        if (commandName === 'verify') {
            const role = options.getRole('role');
            const title = options.getString('title') ?? 'ロール付与';
            const description = options.getString('description') ?? 'ロールの付与を行います。';
            
            const embed = new EmbedBuilder().setTitle(title).setDescription(description);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`v_role_${role.id}`).setLabel('✅認証').setStyle(ButtonStyle.Success));
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'ticket') {
            const adminRole = options.getRole('admin-role');
            const title = options.getString('title') ?? '問い合わせ';
            const description = options.getString('description') ?? 'チケットを作成し管理者に問い合わせができます。';
            const panelDesc = options.getString('panel-desc') ?? 'チケット発行ありがとうございます。メンションされているロールの担当者が来るまでしばらくお待ちください。';
            
            const embed = new EmbedBuilder().setTitle(title).setDescription(description);
            // 複数の情報をボタンIDに詰め込む（注意: 100文字制限があるため簡易的に）
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket_${adminRole.id}`).setLabel('チケットを発行').setStyle(ButtonStyle.Primary));
            // サーバー内でメッセージを受け渡すために、カスタムIDに panelDesc を埋め込むのは難しいため、チケット作成処理でデフォルトを使うか工夫が必要です
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'role-confirmation') {
            const member = options.getMember('target');
            const roles = member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).join('\n') || 'なし';
            await interaction.reply({ content: `**${member.user.tag}** の付与ロール:\n\`\`\`\n${roles}\n\`\`\``, ephemeral: true });
        }
    }

    // [ボタン処理]
    if (interaction.isButton()) {
        // ロール付与
        if (interaction.customId.startsWith('v_role_')) {
            const roleId = interaction.customId.split('_')[2];
            await interaction.member.roles.add(roleId);
            await interaction.reply({ content: `${interaction.user.username} にロールを付与しました！`, ephemeral: true });
        }

        // チケット作成
        if (interaction.customId.startsWith('ticket_')) {
            const adminRoleId = interaction.customId.split('_')[1];
            const channel = await interaction.guild.channels.create({
                name: `🎫｜${interaction.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: adminRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            });

            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('delete_confirm').setLabel('チケット削除').setStyle(ButtonStyle.Danger));
            await channel.send({ content: `${interaction.user} 様\nチケット発行ありがとうございます。メンションされているロールの担当者が来るまでしばらくお待ちください。`, components: [row] });
            await interaction.reply({ content: `チケットを作成しました: ${channel}`, ephemeral: true });
        }

        // 削除確認 (二段階)
        if (interaction.customId === 'delete_confirm') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('delete_yes').setLabel('本当に削除する').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('delete_no').setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ content: '本当にこのチケットを削除しますか？', components: [row], ephemeral: true });
        }

        if (interaction.customId === 'delete_yes') {
            await interaction.channel.delete();
        }
        if (interaction.customId === 'delete_no') {
            await interaction.update({ content: '削除をキャンセルしました。', components: [] });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
